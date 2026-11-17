export const dynamic = 'force-dynamic';

type Item = { id: number; title: string };

export default async function News() {
  let items: Item[] = [];
  try {
    const r = await fetch('https://api.example-news.com/top', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    items = await r.json();
  } catch (e) {
    return <p id="news-error">News is unavailable right now.</p>;
  }
  if (!items.length) return <p id="news-empty">No stories yet.</p>;
  return <ul id="news">{items.map((i) => <li key={i.id}>{i.title}</li>)}</ul>;
}
