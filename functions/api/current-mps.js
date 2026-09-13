// Proxies the UK Parliament Members API so the browser never hits parliament.uk directly.
// Fetches all current Commons members with pagination, returns a flat map keyed by
// lowercase constituency name: { name, party, partyName, startDate }
// Responses are cached at the edge for 1 hour.

export async function onRequest() {
  const TAKE = 100;
  const map  = {};

  const absorb = items => {
    for (const item of (items || [])) {
      const v   = item.value;
      const con = v.latestHouseMembership?.membershipFrom;
      if (con) {
        map[con.toLowerCase()] = {
          name:      v.nameDisplayAs,
          party:     v.latestParty?.abbreviation || '?',
          partyName: v.latestParty?.name || 'Unknown',
          startDate: v.latestHouseMembership?.membershipStartDate?.slice(0, 10) || null,
        };
      }
    }
  };

  const parliamentFetch = (skip) =>
    fetch(
      `https://members-api.parliament.uk/api/Members/Search?House=1&IsCurrentMember=true&skip=${skip}&take=${TAKE}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ASVA-Scorecard/1.0)',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Referer': 'https://members.parliament.uk/',
        },
      }
    );

  try {
    const firstRes = await parliamentFetch(0);
    if (!firstRes.ok) {
      return json({ error: `Parliament API returned ${firstRes.status}` }, 502);
    }
    const firstData = await firstRes.json();
    absorb(firstData.items);

    const total = firstData.totalResults || 0;

    if (total > TAKE) {
      const pages = [];
      for (let skip = TAKE; skip < total; skip += TAKE) {
        pages.push(parliamentFetch(skip).then(r => r.ok ? r.json() : { items: [] }));
      }
      for (const page of await Promise.all(pages)) absorb(page.items);
    }

    return json(map, 200, 'public, max-age=3600');
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
