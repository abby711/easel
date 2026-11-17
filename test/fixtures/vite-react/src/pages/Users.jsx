import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
export default function Users() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch('https://jsonplaceholder.typicode.com/users')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(setUsers).catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="error">Could not load users: {error}</p>;
  if (!users) return <p>Loading…</p>;
  if (!users.length) return <p className="empty">No users yet</p>;
  return <ul>{users.map((u) => <li key={u.id}><Link to={`/users/${u.id}`}>{u.name}</Link></li>)}</ul>;
}
