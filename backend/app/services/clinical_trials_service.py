"""ClinicalTrials.gov integration for fetching trial data."""
import httpx
import json
import subprocess
import logging
import urllib.parse
from typing import Dict, List


CTGOV_API_URL = "https://clinicaltrials.gov/api/v2/studies"
logger = logging.getLogger(__name__)


class ClinicalTrialsService:

    async def search_trials_by_investigator(self, investigator_name: str) -> List[Dict]:
        params = {
            "query.term": investigator_name,
            "filter.overallStatus": "COMPLETED,RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION",
            "pageSize": 100,
            "format": "json",
        }

        # Try httpx first, fall back to curl (CT.gov blocks some Python TLS fingerprints)
        data = await self._fetch_with_httpx(params)
        if data is None:
            data = self._fetch_with_curl(params)

        trials = []
        for study in data.get("studies", []):
            protocol = study.get("protocolSection", {})
            id_module = protocol.get("identificationModule", {})
            status_module = protocol.get("statusModule", {})
            contacts = protocol.get("contactsLocationsModule", {})

            is_pi = False
            investigators = contacts.get("overallOfficials", [])
            for inv in investigators:
                name = inv.get("name", "").lower()
                role = inv.get("role", "").upper()
                if investigator_name.lower() in name and role in ("PRINCIPAL_INVESTIGATOR", "STUDY_DIRECTOR"):
                    is_pi = True
                    break

            trials.append({
                "nct_id": id_module.get("nctId", ""),
                "title": id_module.get("briefTitle", ""),
                "status": status_module.get("overallStatus", ""),
                "is_lead_investigator": is_pi,
            })

        return trials

    async def _fetch_with_httpx(self, params: Dict) -> Dict | None:
        """Try fetching via httpx."""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
            }
            async with httpx.AsyncClient(timeout=30, headers=headers) as client:
                resp = await client.get(CTGOV_API_URL, params=params)
                if resp.status_code == 200:
                    return resp.json()
                logger.debug(f"ClinicalTrials httpx returned {resp.status_code}, falling back to curl")
        except Exception as e:
            logger.debug(f"ClinicalTrials httpx failed: {e}")
        return None

    def _fetch_with_curl(self, params: Dict) -> Dict:
        """Fallback: fetch via curl subprocess (bypasses TLS fingerprint blocks)."""
        try:
            query_string = urllib.parse.urlencode(params)
            url = f"{CTGOV_API_URL}?{query_string}"
            result = subprocess.run(
                ["curl", "-s", "--max-time", "30", url],
                capture_output=True, text=True, timeout=35,
            )
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout)
        except Exception as e:
            logger.error(f"ClinicalTrials curl fallback failed: {e}")
        return {"studies": []}

    async def count_trials_led(self, investigator_name: str) -> int:
        trials = await self.search_trials_by_investigator(investigator_name)
        return sum(1 for t in trials if t["is_lead_investigator"])

    async def get_trial_details(self, investigator_name: str) -> Dict:
        trials = await self.search_trials_by_investigator(investigator_name)
        led = [t for t in trials if t["is_lead_investigator"]]
        return {
            "total_trials_found": len(trials),
            "trials_led": len(led),
            "trial_list": trials[:20],
            "led_trials": led,
        }
