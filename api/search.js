// Live prices for Weekender via SerpApi (Google Flights + Google Hotels).
// Set SERPAPI_KEY in Vercel: Project > Settings > Environment Variables.

const AIRPORTS = {
  BCN: "BCN", MAD: "MAD", LIS: "LIS", PAR: "CDG,ORY,BVA", AMS: "AMS", BER: "BER",
  MUC: "MUC", PRG: "PRG", BUD: "BUD", ROM: "FCO,CIA", FLR: "FLR,PSA",
  LON: "LHR,LGW,STN,LTN", DUB: "DUB"
};
const CITIES = {
  BCN: "Barcelona", MAD: "Madrid", LIS: "Lisbon", PAR: "Paris", AMS: "Amsterdam",
  BER: "Berlin", MUC: "Munich", PRG: "Prague", BUD: "Budapest", ROM: "Rome",
  FLR: "Florence", LON: "London", DUB: "Dublin"
};
// Neighbourhoods where locals eat, away from the main tourist strip
const FOOD_HOODS = {
  BCN: "Gràcia", MAD: "Lavapiés", LIS: "Arroios", PAR: "11th arrondissement", AMS: "De Pijp",
  BER: "Neukölln", MUC: "Glockenbachviertel", PRG: "Vinohrady", BUD: "District VIII", ROM: "Testaccio",
  FLR: "San Frediano", LON: "Hackney", DUB: "Stoneybatter"
};
const CHAINS = /mcdonald|burger king|kfc|starbucks|subway|five guys|hard rock|domino|pizza hut|vapiano|wagamama|nando|telepizza|costa coffee|tim hortons|dunkin/i;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

async function serp(params) {
  const r = await fetch("https://serpapi.com/search.json?" + new URLSearchParams(params));
  const j = await r.json();
  if (j.error && !/returned any results/i.test(j.error)) throw new Error(j.error);
  return j;
}

function stay(p, fallbackUrl) {
  return {
    name: p.name,
    type: p.type,
    rating: p.overall_rating || null,
    reviews: p.reviews || 0,
    perNight: p.rate_per_night?.extracted_lowest ?? null,
    total: p.total_rate?.extracted_lowest ?? null,
    url: p.link || fallbackUrl
  };
}

export default async function handler(req, res) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return res.status(500).json({ error: "SERPAPI_KEY is not set in Vercel" });

  const { type, from, to, city, dep, ret } = req.query;
  const adults = String(Math.min(8, Math.max(1, parseInt(req.query.adults, 10) || 1)));
  if (!isDate(dep) || !isDate(ret)) return res.status(400).json({ error: "Bad dates" });

  const common = { currency: "EUR", hl: "en", gl: "us", api_key: key };

  try {
    if (type === "flights") {
      if (!AIRPORTS[from] || !AIRPORTS[to] || from === to) return res.status(400).json({ error: "Bad route" });
      const j = await serp({
        ...common, engine: "google_flights",
        departure_id: AIRPORTS[from], arrival_id: AIRPORTS[to],
        outbound_date: dep, return_date: ret, type: "1"
      });
      const flights = [...(j.best_flights || []), ...(j.other_flights || [])]
        .map(f => {
          const legs = f.flights || [], a = legs[0] || {}, b = legs[legs.length - 1] || {};
          return {
            airline: a.airline, from: a.departure_airport?.id, to: b.arrival_airport?.id,
            depart: a.departure_airport?.time, arrive: b.arrival_airport?.time,
            minutes: f.total_duration, stops: (f.layovers || []).length, price: f.price
          };
        })
        .filter(f => f.price)
        .sort((x, y) => x.price - y.price)
        .slice(0, 8);
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
      return res.json({ flights, url: j.search_metadata?.google_flights_url });
    }

    if (type === "food") {
      if (!CITIES[city]) return res.status(400).json({ error: "Bad city" });
      const hood = FOOD_HOODS[city];
      const j = await serp({ engine: "google_maps", type: "search", hl: "en", api_key: key, q: `local restaurants in ${hood}, ${CITIES[city]}` });
      const all = (j.local_results || []).map(p => ({
        name: p.title, kind: p.type || "Restaurant", rating: p.rating || 0, reviews: p.reviews || 0,
        price: p.price || "", address: p.address || "",
        url: p.place_id ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}` : `https://www.google.com/maps/search/${encodeURIComponent(p.title + " " + CITIES[city])}`
      })).filter(p => p.name && !CHAINS.test(p.name));
      // Local, not touristy: well rated, but not the mega-review spots every tour bus finds
      let picks = all.filter(p => p.rating >= 4.4 && p.reviews >= 60 && p.reviews <= 4000);
      if (picks.length < 4) picks = all.filter(p => p.rating >= 4.2 && p.reviews >= 30 && p.reviews <= 8000);
      picks.sort((a, b) => (b.rating - a.rating) || (b.reviews - a.reviews));
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
      return res.json({ hood, food: picks.slice(0, 8) });
    }

    if (type === "stays") {
      if (!CITIES[city]) return res.status(400).json({ error: "Bad city" });
      const base = { ...common, engine: "google_hotels", check_in_date: dep, check_out_date: ret, adults: "1", sort_by: "3" };
      const [h, r] = await Promise.all([
        serp({ ...base, q: "hostels in " + CITIES[city] }),
        serp({ ...base, adults, q: CITIES[city], vacation_rentals: "true" })
      ]);
      const hUrl = h.search_metadata?.google_hotels_url, rUrl = r.search_metadata?.google_hotels_url;
      const pick = (j, u) => (j.properties || []).map(p => stay(p, u)).filter(p => p.perNight).slice(0, 6);
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
      return res.json({ hostels: pick(h, hUrl), rentals: pick(r, rUrl) });
    }

    return res.status(400).json({ error: "type must be flights or stays" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
