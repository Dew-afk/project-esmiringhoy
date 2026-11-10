export const Banner = ({ children }) => <div className="banner" role="status">{children}</div>

export const Empty = ({ children }) => <div className="e-none">{children}</div>

export const Panel = ({ title, children, className = '' }) => (
  <section className={`glass panel ${className}`}>
    {title && <h2>{title}</h2>}
    {children}
  </section>
)

export const Field = ({ id, label, children }) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    {children}
  </div>
)
