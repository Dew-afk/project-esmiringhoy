import { Panel, Banner, Empty } from '../ui.jsx'

export default function Appeals() {
  return (
    <>
      <Banner>
        <b>appeals console placeholder:</b> cases, flags and notes come from the backend once escalate creates them,
        the row below is sample layout
      </Banner>
      <Panel title="cases">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>case</th><th>session</th><th>flags</th><th>notes</th><th>state</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>case_0001</td><td>sess_0001</td>
                <td>unauthorized_object at 00:20.2</td>
                <td>sample note from the proctor</td>
                <td><span className="chip chip-scheduled">open</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <Empty>appeals package export arrives with the reporting service</Empty>
      </Panel>
    </>
  )
}
