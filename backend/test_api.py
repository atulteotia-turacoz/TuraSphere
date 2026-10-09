"""Quick end-to-end API test."""
import httpx
import json
import sys

BASE = "http://127.0.0.1:8003/api/v1"

def main():
    client = httpx.Client(timeout=10)

    # 1. Health
    r = client.get("http://127.0.0.1:8003/health")
    assert r.status_code == 200
    print("1. Health check OK")

    # 2. Login
    r = client.post(f"{BASE}/auth/login", json={"email": "admin@tura.com", "password": "Admin@123"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"2. Login OK, token: {token[:20]}...")

    # 3. Create HCP
    r = client.post(f"{BASE}/hcp/", json={
        "full_name": "Dr. Jane Doe",
        "country": "USA",
        "specialty": "Cardiology",
        "hcp_type": "surgeon",
        "institution": "Mayo Clinic",
        "years_of_experience": 20,
        "procedures_per_year": 300
    }, headers=headers)
    assert r.status_code == 201, f"Create HCP failed: {r.text}"
    hcp_id = r.json()["id"]
    print(f"3. Create HCP OK, id={hcp_id}")

    # 4. Manual Assessment
    r = client.post(f"{BASE}/assessments/{hcp_id}/score-manual", json={
        "c1_board_member": True,
        "c1_advisory_board": True,
        "c1_professor": True,
        "c1_society_leader": True,
        "c1_executive_body": True,
        "c2_presentations_count": 15,
        "c2_presentation_level": "international",
        "c3_publications_count": 12,
        "c3_editorial_board": True,
        "c3_intl_journal": True,
        "c3_textbook_contributor": True,
        "c4_years_experience": 20,
        "c4_procedures_per_year": 300,
        "c4_unique_expertise": True,
    }, headers=headers)
    assert r.status_code == 200, f"Score failed: {r.text}"
    data = r.json()
    print(f"4. Assessment OK: Base={data['base_score']}, Bonus={data['bonus_score']}, Final={data['final_score']}, Tier={data['tier']}")

    # 5. Get Assessment
    r = client.get(f"{BASE}/assessments/{hcp_id}", headers=headers)
    assert r.status_code == 200
    print(f"5. Get Assessment OK: Tier={r.json()['tier']}")

    # 6. Admin Dashboard
    r = client.get(f"{BASE}/admin/dashboard", headers=headers)
    assert r.status_code == 200
    d = r.json()
    print(f"6. Admin Dashboard OK: Users={d['total_users']}, HCPs={d['total_hcps']}, Assessments={d['total_assessments']}")

    # 7. Export CSV
    r = client.get(f"{BASE}/assessments/{hcp_id}/export-csv", headers=headers)
    assert r.status_code == 200
    print(f"7. CSV Export OK, size={len(r.text)} bytes")

    # 8. List HCPs
    r = client.get(f"{BASE}/hcp/", headers=headers)
    assert r.status_code == 200
    print(f"8. List HCPs OK: total={r.json()['total']}")

    print("\n=== ALL TESTS PASSED ===")

if __name__ == "__main__":
    main()
