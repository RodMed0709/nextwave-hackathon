package mcp

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/gofrs/uuid"
	"go.uber.org/zap"

	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
)

// pollInterval is how often a watched run is checked for new events. It is the
// floor on how stale the graph can look, and 400ms is well under what reads as
// "live" to a person watching a node change colour.
const pollInterval = 400 * time.Millisecond

// Delta is one graph change as the browser receives it. It mirrors the event row
// rather than the entity that changed: a client applies deltas to a snapshot it
// already loaded, so re-sending whole nodes would waste the bandwidth the
// sequence design exists to save.
type Delta struct {
	Sequence      int64                            `json:"sequence"`
	GraphRevision int64                            `json:"graph_revision"`
	EventType     string                           `json:"event_type"`
	NodeUUID      *uuid.UUID                       `json:"node_uuid,omitempty"`
	Payload       payload_entity.AgentEventPayload `json:"payload"`
	OccurredAt    time.Time                        `json:"occurred_at"`
}

// Broadcaster fans graph deltas out to the browsers watching a run.
//
// Deltas are read from the agent_event table, not handed over in memory from
// whichever goroutine committed them. That indirection is what lets the API and
// the MCP server run as SEPARATE processes: an agent reporting to the MCP
// deployment writes an event, and the API deployment's tailer picks it up on its
// next poll and pushes it to the browsers it is serving. A Go channel could
// never cross that boundary; the database already does.
//
// It also means correctness no longer depends on running a single replica. Every
// API replica tails independently for the runs its own clients are watching.
//
// Polling rather than a message bus is a deliberate trade at this volume (tens of
// runs a day): one indexed query per watched run per 400ms costs nothing, needs
// no Redis, and exercises the same "fetch events after N" path the client uses to
// recover from a gap — so the recovery path is continuously tested instead of
// only in failure.
type Broadcaster struct {
	db     *sql.DB
	logger *zap.Logger

	mu   sync.Mutex
	subs map[uuid.UUID]*runWatch
	next int
}

type runWatch struct {
	chans map[int]chan Delta
	// lastSeen is the highest sequence this process has already fanned out for
	// the run, so each poll asks only for what is new.
	lastSeen int64
	cancel   context.CancelFunc
}

func NewBroadcaster(db *sql.DB, logger *zap.Logger) *Broadcaster {
	return &Broadcaster{db: db, logger: logger, subs: make(map[uuid.UUID]*runWatch)}
}

// Subscribe returns a channel of deltas for one run and a function that releases
// it. The caller MUST call the release function, or the subscription and its
// tailing goroutine live for the life of the process.
//
// from is the sequence the caller has already handled; the tailer only reports
// what comes after it.
func (b *Broadcaster) Subscribe(runUUID uuid.UUID, from int64) (<-chan Delta, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	w, existing := b.subs[runUUID]
	if !existing {
		ctx, cancel := context.WithCancel(context.Background())
		w = &runWatch{chans: make(map[int]chan Delta), lastSeen: from, cancel: cancel}
		b.subs[runUUID] = w
		go b.tail(ctx, runUUID)
	}

	id := b.next
	b.next++
	// Buffered so a slow browser never stalls the tailer that serves the others.
	ch := make(chan Delta, 64)
	w.chans[id] = ch

	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		watch, ok := b.subs[runUUID]
		if !ok {
			return
		}
		if c, ok := watch.chans[id]; ok {
			close(c)
			delete(watch.chans, id)
		}
		if len(watch.chans) == 0 {
			// Nobody is watching this run any more; stop querying for it.
			watch.cancel()
			delete(b.subs, runUUID)
		}
	}
}

// tail polls one run's events for as long as somebody is watching it.
func (b *Broadcaster) tail(ctx context.Context, runUUID uuid.UUID) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.mu.Lock()
			w, ok := b.subs[runUUID]
			if !ok {
				b.mu.Unlock()
				return
			}
			from := w.lastSeen
			b.mu.Unlock()

			deltas, err := deltasAfter(ctx, b.db, runUUID, from)
			if err != nil {
				// A transient database error must not kill the stream; the next
				// tick retries from the same cursor.
				b.logger.Warn("tailing run events failed", zap.Error(err))
				continue
			}
			if len(deltas) == 0 {
				continue
			}
			b.fanOut(runUUID, deltas)
		}
	}
}

func (b *Broadcaster) fanOut(runUUID uuid.UUID, deltas []Delta) {
	b.mu.Lock()
	defer b.mu.Unlock()

	w, ok := b.subs[runUUID]
	if !ok {
		return
	}
	for _, d := range deltas {
		for _, ch := range w.chans {
			select {
			case ch <- d:
			default:
				// A subscriber whose buffer is full is skipped rather than waited
				// on. Dropping is recoverable — the client sees the sequence gap
				// and reconnects with its last good cursor — whereas blocking here
				// would stall every other browser on this run.
			}
		}
		if d.Sequence > w.lastSeen {
			w.lastSeen = d.Sequence
		}
	}
}
