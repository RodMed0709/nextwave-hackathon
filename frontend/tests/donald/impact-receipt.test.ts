import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatReceiptMinutes,
  getStageImpactReceipt,
} from '../../lib/donald/impact-receipt'
import type { NodeSummary, RunNode } from '../../lib/donald/types'

function node(overrides: Partial<RunNode> & { node_key: string; label: string }): RunNode {
  return {
    node_key: overrides.node_key,
    label: overrides.label,
    agent_label: overrides.agent_label ?? null,
    status: overrides.status ?? 'not_started',
    planned: overrides.planned ?? true,
    plan_order: null,
    progress_percent: 0,
    estimated_seconds: null,
    elapsed_seconds: null,
    actual_seconds: null,
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: overrides.output_summary ?? null,
    subtasks: overrides.subtasks,
    artifacts: [],
    removed: overrides.removed ?? false,
    description: overrides.description ?? null,
    node_type: overrides.node_type ?? null,
    tool_name: overrides.tool_name ?? null,
    status_message: null,
    error_message: null,
    manual_minutes: overrides.manual_minutes ?? null,
  }
}

function summary(metrics: NodeSummary['metrics']): NodeSummary {
  return { headline: null, detail: null, metrics, evidence_ids: [] }
}

test('trace-only actions contribute zero to above the line receipts', () => {
  const receipt = getStageImpactReceipt('above', [
    node({ node_key: 'ingest_asn', label: 'Read the shipment notice', status: 'succeeded', manual_minutes: 30 }),
    node({ node_key: 'identify_po', label: 'Find the purchase order', status: 'succeeded', manual_minutes: 30 }),
    node({ node_key: 'monitor_eta', label: 'Track the ETA', status: 'succeeded', manual_minutes: 30 }),
  ])

  assert.equal(receipt.timeSavedMinutes, null)
  assert.equal(receipt.valueProtectedUsd, null)
  assert.equal(receipt.quantifiedJobs, 0)
  assert.equal(receipt.timeNote, 'Not yet quantified')
  assert.equal(receipt.valueNote, 'Visibility layer')
  assert.deepEqual(receipt.contributions, [])
})

test('proposed and running receipt actions contribute zero until completed', () => {
  const receipt = getStageImpactReceipt('below', [
    node({ node_key: 'detect_schedule_change', label: 'Detect schedule change', status: 'not_started' }),
    node({ node_key: 'reconcile_booking', label: 'Reconcile booking', status: 'in_progress' }),
  ])

  assert.equal(receipt.timeSavedMinutes, null)
  assert.equal(receipt.valueProtectedUsd, null)
  assert.equal(receipt.quantifiedJobs, 0)
  assert.equal(receipt.timeNote, 'No completed quantified jobs')
})

test('completed detect contributes benchmark investigation time', () => {
  const receipt = getStageImpactReceipt('below', [
    node({ node_key: 'detect_schedule_change', label: 'Detect schedule change', status: 'succeeded' }),
  ])

  assert.equal(receipt.timeSavedMinutes, 15)
  assert.equal(receipt.quantifiedJobs, 1)
  assert.equal(receipt.contributions[0]?.provenance, 'benchmark-based')
})

test('completed reconcile contributes conservative benchmark time', () => {
  const receipt = getStageImpactReceipt('below', [
    node({ node_key: 'reconcile_booking', label: 'Reconcile booking', status: 'succeeded' }),
  ])

  assert.equal(receipt.timeSavedMinutes, 10)
  assert.equal(receipt.quantifiedJobs, 1)
  assert.match(receipt.contributions[0]?.explanation ?? '', /conservative/)
})

test('predict contributes only when measured lead-time exists', () => {
  const withoutLeadTime = getStageImpactReceipt('below', [
    node({ node_key: 'predict_overrun', label: 'Forecast the overrun', status: 'succeeded' }),
  ])
  const withLeadTime = getStageImpactReceipt('below', [
    node({
      node_key: 'predict_overrun',
      label: 'Forecast the overrun',
      status: 'succeeded',
      output_summary: summary({ lead_time_hours: 6 }),
    }),
  ])

  assert.equal(withoutLeadTime.contributions.length, 0)
  assert.equal(withLeadTime.timeSavedMinutes, null)
  assert.equal(withLeadTime.valueProtectedUsd, null)
  assert.equal(withLeadTime.contributions.length, 1)
  assert.equal(withLeadTime.contributions[0]?.kind, 'lead-time')
  assert.equal(withLeadTime.contributions[0]?.provenance, 'measured')
})

test('act only contributes value when shipment-specific exposure inputs exist', () => {
  const withoutExposure = getStageImpactReceipt('below', [
    node({ node_key: 'act_book_alternate', label: 'Book alternate carrier', status: 'succeeded' }),
  ])
  const directExposure = getStageImpactReceipt('below', [
    node({
      node_key: 'act_book_alternate',
      label: 'Book alternate carrier',
      status: 'succeeded',
      output_summary: summary({ exposure_avoided_usd: 552 }),
    }),
  ])
  const benchmarkExposure = getStageImpactReceipt('below', [
    node({
      node_key: 'act_book_alternate',
      label: 'Book alternate carrier',
      status: 'succeeded',
      output_summary: summary({ containers_affected: 2, exposure_days: 2 }),
    }),
  ])

  assert.equal(withoutExposure.valueProtectedUsd, null)
  assert.equal(directExposure.valueProtectedUsd, 552)
  assert.equal(directExposure.valueProvenance, 'measured')
  assert.equal(benchmarkExposure.valueProtectedUsd, 552)
  assert.equal(benchmarkExposure.valueProvenance, 'benchmark-based')
})

test('receipt does not double count one node with time and value contributions', () => {
  const receipt = getStageImpactReceipt('below', [
    node({
      node_key: 'act_book_alternate',
      label: 'Book alternate carrier',
      status: 'succeeded',
      output_summary: summary({ exposure_avoided_usd: 552 }),
    }),
  ])

  assert.equal(receipt.contributions.length, 1)
  assert.equal(receipt.quantifiedJobs, 1)
})

test('breakdown totals equal receipt totals', () => {
  const receipt = getStageImpactReceipt('below', [
    node({ node_key: 'detect_schedule_change', label: 'Detect schedule change', status: 'succeeded' }),
    node({ node_key: 'extract_bl', label: 'Extract bill of lading', status: 'succeeded' }),
    node({ node_key: 'reconcile_booking', label: 'Reconcile booking', status: 'succeeded' }),
    node({
      node_key: 'act_book_alternate',
      label: 'Book alternate carrier',
      status: 'succeeded',
      output_summary: summary({ exposure_avoided_usd: 552 }),
    }),
  ])
  const timeTotal = receipt.contributions.reduce((total, contribution) => total + (contribution.timeSavedMinutes ?? 0), 0)
  const valueTotal = receipt.contributions.reduce((total, contribution) => total + (contribution.valueProtectedUsd ?? 0), 0)

  assert.equal(receipt.timeSavedMinutes, timeTotal)
  assert.equal(receipt.valueProtectedUsd, valueTotal)
  assert.equal(formatReceiptMinutes(receipt.timeSavedMinutes), '40 min')
})

test('missing data returns null totals instead of fake values', () => {
  const receipt = getStageImpactReceipt('below', [
    node({ node_key: 'plan_responses', label: 'Generate and rank responses', status: 'succeeded' }),
    node({ node_key: 'explain_root_cause', label: 'Root cause the conflict', status: 'succeeded', manual_minutes: 90 }),
  ])

  assert.equal(receipt.timeSavedMinutes, null)
  assert.equal(receipt.valueProtectedUsd, null)
  assert.equal(receipt.quantifiedJobs, 0)
  assert.deepEqual(receipt.contributions, [])
})


test('receipt contexts use supported data-bank facts for above and below the line', () => {
  const above = getStageImpactReceipt('above', [
    node({ node_key: 'monitor_eta', label: 'Track the ETA', status: 'succeeded' }),
  ])
  const below = getStageImpactReceipt('below', [
    node({ node_key: 'reconcile_booking', label: 'Reconcile booking', status: 'succeeded' }),
    node({ node_key: 'plan_responses', label: 'Generate responses', status: 'succeeded' }),
  ])

  assert.match(above.contexts[0]?.text ?? '', /80% of shippers/)
  assert.match(above.contexts[1]?.text ?? '', /57%/)
  assert.ok(below.contexts.some((context) => /30-60%/.test(context.text)))
  assert.ok(below.contexts.some((context) => /10-15 minutes/.test(context.text)))
})
