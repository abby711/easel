export default function Button({ variant = 'secondary', children }) {
  return <button className={`btn btn-${variant}`}>{children}</button>;
}
