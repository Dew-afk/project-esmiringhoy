import { Panel, Banner, Empty } from '../ui.jsx'

export default function Reports() {
  return (
    <>
      <Banner>
        <b>reports placeholder:</b> aggregates are computed by the reporting service from real rows,
        no invented metrics are shown anywhere in this app
      </Banner>
      <Panel title="session integrity">
        <div className="formrow">
          <button className="btn ghost" disabled>export pdf (needs the reporting service)</button>
          <button className="btn ghost" disabled>export csv (needs the reporting service)</button>
        </div>
        <Empty>session integrity reports include flags, timestamps and the advisory summary with its model version</Empty>
      </Panel>
      <Panel title="cohort analytics">
        <Empty>analytics fill from RiskScores and SessionSummaries once those tables exist</Empty>
      </Panel>
      <Panel title="audit and compliance">
        <Empty>every review action and export writes an AuditLog row with before and after values: the table renders here</Empty>
      </Panel>
    </>
  )
}
