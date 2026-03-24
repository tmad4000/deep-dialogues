import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('contributor_name')
      .eq('status', 'published')
      .not('contributor_name', 'is', null);

    if (error) return res.status(500).json({ error: error.message });

    const counts = {};
    for (const row of data || []) {
      const name = row.contributor_name;
      counts[name] = (counts[name] || 0) + 1;
    }

    const contributors = Object.entries(counts)
      .map(([contributor_name, count]) => ({ contributor_name, count }))
      .sort((a, b) => b.count - a.count);

    return res.json(contributors);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
