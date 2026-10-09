"""X (Twitter) search for KOL scraping.

X's API cannot filter by profession/city on profiles — there is no people-search
endpoint. The realistic approach, used here, is `GET /2/tweets/search/recent`:
search recent tweet *text* by keywords built from the criteria, then take the
*authors* of the matching tweets as candidate KOLs. This finds people who recently
tweeted about the topic — not a complete registry — so results need human review.
"""
import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.twitter_config import TwitterConfig, twitter_configured

logger = logging.getLogger(__name__)

RECENT_SEARCH_URL = "https://api.x.com/2/tweets/search/recent"

# Recent-search query cap on the lower access tiers.
MAX_QUERY_LEN = 500

# Appended to every query: original posts by real practitioners, not chatter.
QUERY_SUFFIX = " -is:retweet -is:reply lang:en"

# Profile fields requested for every X user we look at. X has no email or phone
# field to ask for — those only ever appear if written into the bio (`description`).
USER_FIELDS = "name,username,description,location,public_metrics,verified,url,profile_image_url"


class TwitterNotConfigured(Exception):
    """No usable bearer token for this account (own or platform)."""


class TwitterSearchError(Exception):
    """X returned a non-200 the UI should surface verbatim."""


def resolve_bearer(db: Session, owner_user_id: int) -> Optional[str]:
    """The bearer token to search with: the account's own, else the platform's."""
    own = db.query(TwitterConfig).filter(TwitterConfig.owner_user_id == owner_user_id).first()
    if twitter_configured(own) and own.bearer_token:
        return own.bearer_token
    glob = db.query(TwitterConfig).filter(TwitterConfig.owner_user_id.is_(None)).first()
    if twitter_configured(glob) and glob.bearer_token:
        return glob.bearer_token
    return None


def _quote_phrase(term: str) -> str:
    term = (term or "").strip()
    if not term:
        return ""
    # Multi-word terms must be quoted so X treats them as a phrase.
    return f'"{term}"' if " " in term else term


def _dedupe_ci(terms: list[str]) -> list[str]:
    """Drop case-insensitive duplicates, keeping the first spelling and order."""
    out, seen = [], set()
    for t in terms:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def _assemble(topic_terms: list[str], loc_terms: list[str]) -> str:
    parts = []
    if topic_terms:
        parts.append(f"({' OR '.join(topic_terms)})")
    if loc_terms:
        parts.append(f"({' OR '.join(loc_terms)})")
    return " ".join(parts) + QUERY_SUFFIX


def build_query(criteria: dict) -> str:
    """Assemble an X recent-search query from the KOL criteria.

    Topic terms (therapeutic area / specialty / subspecialty / functional
    expertise, plus the therapeutic area's supporting keywords) are OR-ed
    together; location terms (city / state) are OR-ed together; the two groups
    are AND-ed. Retweets and replies are excluded and English is preferred, to
    bias toward original posts by real practitioners.
    """
    topic = [criteria.get(k) for k in
             ("therapeutic_area", "specialty", "subspecialty", "functional_expertise")]
    # A bare institution name is a useful topic hint too.
    topic.append(criteria.get("institution"))
    # The therapeutic area's supporting keywords (Account → Categories): a
    # dermatologist rarely tweets the word "Dermatology", but does say
    # "skin specialist" or "DNB dermatology". Least specific, so these go last —
    # they are the first to be dropped if the query overruns.
    topic += list(criteria.get("topic_keywords") or [])
    topic_terms = [_quote_phrase(t) for t in topic if t and str(t).strip()]

    # Location terms, most-specific-wins. X matches tweet TEXT, not the author's
    # real location, and these are OR-ed — so mixing a broad region ("India") with
    # a specific city ("Meerut") is self-defeating: almost every Indian doctor
    # mentions "India", which then matches everyone and drowns out the city.
    #
    # So: if a city or state is given, search on those alone. The broad region
    # (or a real-place Geographic Zone) is used ONLY when no city/state narrows it.
    city = (criteria.get("city") or "").strip()
    state = (criteria.get("state") or "").strip()
    state_city = (criteria.get("state_city") or "").strip()
    zone = (criteria.get("geographic_zone") or "").strip()
    is_place_zone = bool(zone) and zone.lower() not in ("north", "south", "east", "west")

    if city or state or state_city:
        loc = [city, state, state_city]
    elif is_place_zone:
        loc = [zone]
    else:
        loc = []
    loc_terms = [_quote_phrase(t) for t in loc if t and str(t).strip()]

    # X search is case-insensitive, so "Dermatology" and "dermatology" are the same
    # term — dedupe case-insensitively (keeping the first spelling) rather than
    # spending the length budget twice on it.
    topic_terms = _dedupe_ci(topic_terms)
    loc_terms = _dedupe_ci(loc_terms)

    # Nothing positive to match on. Returning just the suffix would be an invalid
    # X query, and inventing a default term here would silently search for
    # something the user never asked for — so let the caller report it.
    if not topic_terms and not loc_terms:
        return ""

    # Slicing a too-long query mid-phrase leaves an unbalanced quote or paren,
    # which X rejects outright. Drop whole topic terms from the end (the least
    # specific ones) until it fits. Location is the tighter filter, so it stays.
    while topic_terms and len(_assemble(topic_terms, loc_terms)) > MAX_QUERY_LEN:
        topic_terms.pop()

    query = _assemble(topic_terms, loc_terms)
    # Only reachable if the location group alone overruns; better a valid query
    # on fewer places than an invalid one.
    while loc_terms and len(query) > MAX_QUERY_LEN:
        loc_terms.pop()
        query = _assemble(topic_terms, loc_terms)
    return query


def _suggest_influence(followers: int) -> Optional[str]:
    """Rough Influence Level from follower count (user can override)."""
    if followers is None:
        return None
    if followers >= 500_000:
        return "Global"
    if followers >= 100_000:
        return "National"
    if followers >= 20_000:
        return "Regional"
    if followers > 0:
        return "Local"
    return None


def search_candidates(bearer_token: str, query: str, limit: int = 40) -> list[dict]:
    """Run recent search and return de-duplicated author profiles."""
    limit = max(10, min(limit, 100))
    params = {
        "query": query,
        "max_results": limit,
        "tweet.fields": "author_id",
        "expansions": "author_id",
        "user.fields": USER_FIELDS,
    }
    try:
        with httpx.Client(timeout=25) as client:
            resp = client.get(RECENT_SEARCH_URL, params=params,
                              headers={"Authorization": f"Bearer {bearer_token}"})
    except httpx.HTTPError as exc:
        logger.warning("X search transport error: %s", exc)
        raise TwitterSearchError(f"Could not reach the X API: {exc.__class__.__name__}")

    if resp.status_code == 401:
        raise TwitterSearchError("X rejected the credentials (401). Re-check the bearer token.")
    if resp.status_code == 402:
        raise TwitterSearchError("Your X API plan has no credits left (402). Top up in the X Developer Portal.")
    if resp.status_code == 429:
        raise TwitterSearchError("X rate limit hit (429). Wait a minute and try again.")
    if resp.status_code != 200:
        raise TwitterSearchError(f"X returned HTTP {resp.status_code}.")

    payload = resp.json()
    users = (payload.get("includes") or {}).get("users") or []

    seen, candidates = set(), []
    for u in users:
        handle = (u.get("username") or "").strip()
        if not handle or handle.lower() in seen:
            continue
        seen.add(handle.lower())
        candidates.append(_user_to_candidate(u, source="tweet"))

    candidates.sort(key=lambda c: c.get("x_followers") or 0, reverse=True)
    return candidates


def _user_to_candidate(u: dict, source: str) -> dict:
    """Shape an X user object into our candidate dict. `source` = tweet | follower | following."""
    handle = (u.get("username") or "").strip()
    followers = (u.get("public_metrics") or {}).get("followers_count")
    return {
        "key": handle,
        "source": "x",
        "name": u.get("name"),
        "bio": u.get("description"),
        "location": u.get("location"),
        "profile_url": f"https://x.com/{handle}",
        "image_url": u.get("profile_image_url"),
        "x_username": handle,
        "x_followers": followers,
        "x_verified": bool(u.get("verified")),
        "suggested_influence_level": _suggest_influence(followers),
        "discovered_via": source,
    }


# ── Method 3: discover via a hub account's followers / following ──────

USERS_URL = "https://api.x.com/2/users/by/username/{handle}"
CONNECTIONS_URL = "https://api.x.com/2/users/{uid}/{kind}"  # kind = followers | following

# Last-resort bio hints, used only when the chosen therapeutic area has no
# keywords configured (Account → Categories). These are dermatology-specific, so
# they are a fallback for the legacy derm flow — never mixed into a keyworded
# search, which would match derm bios while looking for, say, cardiologists.
FALLBACK_BIO_HINTS = ("dermatolog", "derma ", "derma,", "skin ", "cosmetolog", "tricholog",
                      "venereolog", "aesthetic", "mbbs", " md ", "dvd", "dnb")


def _place_match(text: str, needles: list[str]) -> bool:
    text = (text or "").lower()
    return any(n and n.lower() in text for n in needles)


def profile_matches(u: dict, topic_needles: list[str], place_needles: list[str]) -> bool:
    """Keep a profile only if its BIO matches the topic and (if a place was asked
    for) its LOCATION mentions it. This is what turns a hub's random followers into
    actual KOLs.

    `topic_needles` are the therapeutic area's keywords plus its specialty terms —
    what the user configured, not a fixed list.
    """
    bio = (u.get("description") or "").lower()
    hints = [t.lower() for t in topic_needles if t and str(t).strip()]
    if not hints:
        hints = list(FALLBACK_BIO_HINTS)
    if not any(h in bio for h in hints):
        return False
    if place_needles:
        return _place_match(u.get("location"), place_needles)
    return True


def resolve_user(bearer_token: str, handle: str) -> Optional[dict]:
    handle = handle.lstrip("@").strip()
    if not handle:
        return None
    try:
        with httpx.Client(timeout=20) as client:
            r = client.get(USERS_URL.format(handle=handle),
                           params={"user.fields": USER_FIELDS},
                           headers={"Authorization": f"Bearer {bearer_token}"})
    except httpx.HTTPError as exc:
        logger.warning("X lookup @%s transport error: %s", handle, exc)
        return None  # skip this hub rather than failing the whole scrape
    if r.status_code == 200:
        return (r.json() or {}).get("data")
    if r.status_code in (401, 402, 429):
        raise TwitterSearchError({
            401: "X rejected the credentials (401).",
            402: "Your X API plan has no credits left (402).",
            429: "X rate limit hit (429). Wait a minute and try again.",
        }[r.status_code])
    return None


def fetch_connections(bearer_token: str, uid: str, kind: str = "followers",
                      max_users: int = 200) -> list[dict]:
    """Page through a user's followers/following, up to `max_users`.

    Followers/following are heavily rate-limited on X, so we cap the number of
    pages rather than draining a large account.
    """
    assert kind in ("followers", "following")
    out, token = [], None
    per_page = min(100, max_users)
    with httpx.Client(timeout=25) as client:
        while len(out) < max_users:
            params = {"max_results": per_page, "user.fields": USER_FIELDS}
            if token:
                params["pagination_token"] = token
            try:
                r = client.get(CONNECTIONS_URL.format(uid=uid, kind=kind), params=params,
                               headers={"Authorization": f"Bearer {bearer_token}"})
            except httpx.HTTPError as exc:
                # Transient network blip (e.g. connection reset) — stop paging and
                # keep whatever we already gathered rather than failing the scrape.
                logger.warning("X %s transport error after %d users: %s", kind, len(out), exc)
                break
            if r.status_code == 429:
                logger.warning("X %s rate-limited after %d users", kind, len(out))
                break
            if r.status_code != 200:
                if not out:
                    raise TwitterSearchError(f"X returned HTTP {r.status_code} for {kind}.")
                break
            body = r.json()
            out.extend(body.get("data") or [])
            token = (body.get("meta") or {}).get("next_token")
            if not token:
                break
    return out[:max_users]


def search_via_followers(bearer_token: str, hub_handles: list[str], criteria: dict,
                         per_hub: int = 200) -> list[dict]:
    """For each hub account, scan its followers AND following, keep the profiles
    that look like dermatologists in the requested place. Returns candidates."""
    topic_needles = [criteria.get(k) for k in
                     ("therapeutic_area", "specialty", "subspecialty")]
    # The area's supporting keywords are what bios actually say, so they do most
    # of the matching work here.
    topic_needles += list(criteria.get("topic_keywords") or [])
    topic_needles = [t for t in topic_needles if t and str(t).strip()]
    place_needles = [criteria.get(k) for k in ("city", "state", "state_city", "geographic_zone")]
    place_needles = [p for p in place_needles
                     if p and str(p).strip() and str(p).lower() not in ("north", "south", "east", "west")]

    seen, candidates = set(), []
    for handle in hub_handles:
        hub = resolve_user(bearer_token, handle)
        if not hub:
            continue
        uid = hub["id"]
        for kind in ("followers", "following"):
            try:
                users = fetch_connections(bearer_token, uid, kind, max_users=per_hub)
            except TwitterSearchError:
                users = []
            for u in users:
                uname = (u.get("username") or "").lower()
                if not uname or uname in seen:
                    continue
                if not profile_matches(u, topic_needles, place_needles):
                    continue
                seen.add(uname)
                candidates.append(_user_to_candidate(u, source=f"{kind}:@{handle.lstrip('@')}"))

    candidates.sort(key=lambda c: c.get("x_followers") or 0, reverse=True)
    return candidates
