package app

import (
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	donaldmcp "github.com/nextwave/donald/app/mcp"
	"github.com/nextwave/donald/core"
	restserver "github.com/nextwave/donald/rest/server"
)

// ProvideCustomRoutes is wired in main.go; it hands your custom REST routes to
// the generated REST server, which mounts them after the generated CRUD routes
// (so you can add new endpoints or override generated ones on the same path).
//
// Add your routes below — this file is generated ONCE and will not be
// overwritten. Adding a REST endpoint needs no code generation.
//
// THE CONTRACT — `r` is the server's ROOT chi router, and you get it AFTER the
// generated routes are mounted and AFTER the generated middleware (request id,
// recoverer, logger, CORS) is installed. chi forbids two things on a
// mux that already has routes, and it enforces both with a PANIC raised while
// the router is being built — so the offending code compiles, ships, and then
// crash-loops the container on start.
//
// First: spell the FULL path, including the /v1 prefix. Do not re-mount it.
//
//	r.Get("/v1/custom/ping", h)     // correct
//	r.Get("/custom/ping", h)          // compiles, but registers at the ROOT
//	r.Route("/v1", func(sub chi.Router) { ... })
//	// PANIC: attempting to Mount() a handler on an existing path, '/v1'
//	// — the generated CRUD routes already occupy it
//
// Second: scope middleware with r.Group, never r.Use.
//
//	r.Use(mw)
//	// PANIC: all middlewares must be defined before routes on a mux
//
//	r.Group(func(g chi.Router) {      // correct
//		g.Use(mw)
//		g.Get("/v1/custom/ping", h)
//	})
//
// What you get for free: the generated middleware chain already applies to your
// routes, and a
// custom route on a generated path takes precedence over the generated handler
// (chi matches a static route before a mount).
//
// Response helpers: restserver.ListEnvelope[T] is exported and is the shape the
// generated list endpoints return. The rest — writeJSON, writeProblem,
// parseListParams, <entity>Declarations — are unexported, so a custom handler
// writes its own JSON. Match the generated error shape (RFC 7807 problem+json:
// type/title/status/detail) if you want one error format across the API.
func ProvideCustomRoutes(coreImpl *core.Implementation, logger *zap.Logger) restserver.CustomRoutesFn {
	return func(r chi.Router) {
		// Everything Donald adds on top of the generated CRUD lives in app/mcp:
		// the MCP server the client's agents report through, and the SSE stream
		// the web app subscribes to. Which of the two this process serves is
		// decided by DONALD_ROLE (api | mcp | all) so the same image can run as
		// two isolated deployments.
		//
		// Note the full "/v1/..." paths used inside — see the contract above.
		donaldmcp.Register(r, coreImpl, logger)
	}
}
