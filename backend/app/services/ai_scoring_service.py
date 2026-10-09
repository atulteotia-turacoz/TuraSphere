"""AI-powered KOL assessment scoring service.
Uses the configured LLM (OpenAI or Anthropic) to analyze CV text
and score each assessment parameter."""

import json
import re
import logging
from datetime import date
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models.configuration import AIConfiguration

logger = logging.getLogger(__name__)

# Scoring is arithmetic against a rubric, not a creative task: count the items
# inside a date window, compare against a threshold, pick a number. Accounts
# commonly leave the configured temperature at 0.7, which let the same CV score
# differently on re-runs — the "past five years" window in particular. Pinned
# low here for the same reason extraction pins EXTRACTION_TEMPERATURE in
# api/endpoints/hcp.py. The account's configured temperature still applies to
# any other use of that config.
SCORING_TEMPERATURE = 0.1


def get_default_ai_config(db: Session) -> Optional[AIConfiguration]:
    """Get the default active AI configuration."""
    config = db.query(AIConfiguration).filter(
        AIConfiguration.is_default == True,
        AIConfiguration.is_active == True,
    ).first()
    if not config:
        config = db.query(AIConfiguration).filter(
            AIConfiguration.is_active == True,
        ).first()
    return config


def build_scoring_prompt(
    cv_text: str,
    parameters: List[Dict],
    hcp_name: str,
    form_data: Optional[Dict] = None,
) -> str:
    """Build the LLM prompt for scoring parameters from CV and/or form data."""
    param_list = ""
    for p in parameters:
        param_list += (
            f"- Parameter ID: {p['id']}\n"
            f"  Code: {p['code']}\n"
            f"  Name: {p['name']}\n"
            f"  Category: {p['category']}\n"
            f"  Description: {p.get('description') or 'N/A'}\n"
            f"  Max Score: {p['max_score']}\n\n"
        )

    # Build form data context section
    form_section = ""
    if form_data:
        form_lines = []
        field_labels = {
            "full_name": "Full Name",
            "city": "City / Location",
            "specialty": "Specialty / Therapeutic Area",
            "institution": "Current Institute / Hospital / Organization",
            "designation": "Current Designation / Position",
            "faculty_positions": "Faculty Positions & Affiliations (current and past)",
            "education": "Qualifications / Degrees (with years)",
            "years_of_experience": "Years of Experience",
            "unique_expertise": "Unique Surgical / Clinical Expertise",
            "procedures_per_year": "Procedures or Surgeries per Year",
            "age_estimate": "Estimated Age",
            "key_clinical_interests": "Key Clinical or Research Interests",
            "publications": "Publications",
            "conference_presentations": "Conference Presentations / Speaker Activities",
            "advisory_board": "Advisory Board Participation",
            "textbooks": "Textbooks / Book Chapters Authored or Edited",
            "office_bearer_positions": "Office Bearer / Leadership Positions in Medical Associations",
            "medical_registration_no": "Medical Registration Number",
            "affiliated_to_government": "Affiliated to Government Organisation",
            "professional_memberships": "Professional Memberships",
            "awards_recognitions": "Awards / Recognitions",
            "linkedin_info": "LinkedIn Profile Information",
        }
        for key, label in field_labels.items():
            val = form_data.get(key)
            if val:
                form_lines.append(f"- {label}: {val}")
        if form_lines:
            form_section = "\n## HCP Profile Information (from form submission):\n" + "\n".join(form_lines) + "\n"

    # Build data source description
    has_cv = bool(cv_text and cv_text.strip())
    has_form = bool(form_section)

    if has_cv and has_form:
        data_description = (
            f'You are given a CV/resume AND additional profile information for a healthcare professional named "{hcp_name}".\n'
            "Use BOTH the CV content and the form data to score each parameter. "
            "The form data may contain details not present in the CV (e.g., publications, conferences, memberships, awards)."
        )
    elif has_cv:
        data_description = (
            f'You are given the CV/resume of a healthcare professional named "{hcp_name}".\n'
            "Analyze the CV and score each parameter based on the evidence found."
        )
    else:
        data_description = (
            f'You are given profile information for a healthcare professional named "{hcp_name}".\n'
            "Score each parameter based on the provided information. "
            "Be fair — award scores only where the information clearly supports the criteria."
        )

    cv_section = ""
    if has_cv:
        cv_section = f"\n## CV Content:\n---\n{cv_text[:15000]}\n---\n"

    # Several parameters are bounded by a period — "in the past five years",
    # "in the last 5 years". The prompt used to carry no date at all, so the
    # model had nothing to measure that against and counted a talk given in
    # 2015 as recent. Client reported exactly this: speaker engagements from
    # beyond five years scored as if they were inside the window.
    today = date.today()
    window_start = today.year - 5

    prompt = f"""You are an expert KOL (Key Opinion Leader) assessment analyst for the healthcare/pharmaceutical industry.

## Today's date: {today.isoformat()} (current year: {today.year})

{data_description}
{form_section}{cv_section}
## Assessment Parameters to Score:
{param_list}

## Instructions:
1. Analyze all provided information thoroughly and identify relevant evidence for each parameter.
2. For each parameter, assign a score from 0 up to its max_score based on the evidence available.
3. Provide a brief justification (1-2 sentences) explaining why you assigned that score.
4. If no information is available for a parameter, assign 0 and note "No evidence found".
5. Be fair and objective. Only score based on what is explicitly stated or strongly implied.

### Time windows — read carefully
Some parameters are limited to a period, e.g. "in the past five years" or "in
the last 5 years". Today is {today.isoformat()}, so that window is
**{window_start}-{today.year} inclusive**. For any such parameter:
  a. Count ONLY items dated {window_start} or later. An entry from {window_start - 1}
     or earlier is outside the window and must NOT be counted, however impressive.
  b. Do not treat an undated entry as recent. If an item has no year, exclude it
     from the count and say so in the justification.
  c. State the window and the number of qualifying items in your justification,
     e.g. "3 speaking engagements dated {window_start}-{today.year}; 6 further
     engagements fall outside the window."
  d. If every item is outside the window, the score for that parameter is 0 —
     say which years were found.
Parameters with no stated period are scored on the whole record as usual.

6. Also extract the following profile information if available:
   - full_name: The person's full name
   - email: Email address
   - specialty: Medical specialty
   - institution: Current institution/hospital
   - country: Country
   - years_of_experience: Years of experience (number)
   - education: Education details
   - designation: Current position/designation
   - key_clinical_interests: Research/clinical interests

## Response Format:
You MUST respond with valid JSON only. No markdown, no explanation outside JSON.

{{
  "profile": {{
    "full_name": "extracted name or null",
    "email": "extracted email or null",
    "specialty": "extracted specialty or null",
    "institution": "extracted institution or null",
    "country": "extracted country or null",
    "years_of_experience": null,
    "education": "extracted education or null",
    "designation": "extracted designation or null",
    "key_clinical_interests": "extracted interests or null"
  }},
  "scores": [
    {{
      "parameter_id": <id>,
      "score": <number>,
      "justification": "<brief explanation>"
    }}
  ],
  "overall_summary": "<2-3 sentence summary of the HCP's KOL profile>"
}}"""

    return prompt


def _parse_json_response(content: str) -> dict:
    """Parse JSON from LLM response, handling markdown code blocks and malformed output."""
    content = content.strip()

    # Strip markdown code blocks
    if content.startswith("```"):
        # Remove opening ```json or ```
        content = re.sub(r'^```(?:json)?\s*\n?', '', content)
        # Remove closing ```
        content = re.sub(r'\n?```\s*$', '', content)

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in the response
    match = re.search(r'\{[\s\S]*\}', content)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # An unterminated JSON object means the model hit its output cap. That is a
    # different failure from a malformed answer and needs a different fix, so
    # say which one it is instead of "please try again" — retrying never helped.
    stripped = content.strip()
    if stripped.startswith("{") and not stripped.endswith("}"):
        logger.error(f"LLM response truncated at the output limit ({len(content)} chars): ...{content[-200:]}")
        raise ValueError(
            "The AI response was cut off before it finished — this CV is longer than "
            "the configured output limit. Raise max_tokens on the AI configuration."
        )
    logger.error(f"Failed to parse LLM response as JSON: {content[:500]}")
    raise ValueError("AI returned an invalid response. Please try again.")


def call_openai(config: AIConfiguration, prompt: str, temperature: float = None,
                max_tokens: int = None) -> dict:
    """Call OpenAI API.

    `temperature` overrides the configured one — pass a low value for verbatim
    extraction tasks, where the account's scoring temperature is too creative.

    `max_tokens` likewise. A field extraction returning five array fields off a
    long CV does not fit the 4096 accounts are configured with: the JSON came
    back cut mid-string and the whole extraction failed with "AI returned an
    invalid response", so the user had to type an 11-page CV by hand.
    """
    from openai import OpenAI

    client_kwargs = {"api_key": config.api_key}
    if config.api_base_url:
        client_kwargs["base_url"] = config.api_base_url

    client = OpenAI(**client_kwargs)

    response = client.chat.completions.create(
        model=config.model_name or "gpt-4",
        messages=[
            {"role": "system", "content": "You are a healthcare KOL assessment expert. Always respond with valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=max_tokens or config.max_tokens or 4096,
        temperature=(config.temperature or 0.3) if temperature is None else temperature,
        timeout=90,
    )

    content = response.choices[0].message.content
    return _parse_json_response(content)


def call_anthropic(config: AIConfiguration, prompt: str, temperature: float = None) -> dict:
    """Call Anthropic Claude API.

    `temperature` overrides the configured one — see `call_openai`.
    """
    import anthropic

    client_kwargs = {"api_key": config.api_key}
    if config.api_base_url:
        client_kwargs["base_url"] = config.api_base_url

    client = anthropic.Anthropic(**client_kwargs)

    response = client.messages.create(
        model=config.model_name or "claude-sonnet-4-20250514",
        max_tokens=max_tokens or config.max_tokens or 4096,
        temperature=(config.temperature or 0.3) if temperature is None else temperature,
        messages=[
            {"role": "user", "content": prompt},
        ],
        system="You are a healthcare KOL assessment expert. Always respond with valid JSON only.",
    )

    content = response.content[0].text
    return _parse_json_response(content)


def score_cv_with_ai(
    db: Session,
    cv_text: str,
    parameters: List[Dict],
    hcp_name: str,
    form_data: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Score a CV and/or form data using the configured AI provider."""
    config = get_default_ai_config(db)
    if not config:
        raise ValueError("No AI configuration found. Please configure an AI provider in the admin panel.")

    prompt = build_scoring_prompt(cv_text, parameters, hcp_name, form_data)

    provider = (config.provider or "").lower()
    if provider in ("openai", "gpt"):
        result = call_openai(config, prompt, temperature=SCORING_TEMPERATURE)
    elif provider in ("anthropic", "claude"):
        result = call_anthropic(config, prompt, temperature=SCORING_TEMPERATURE)
    else:
        result = call_openai(config, prompt, temperature=SCORING_TEMPERATURE)

    # Validate response structure
    if "scores" not in result:
        result["scores"] = []
    if "profile" not in result:
        result["profile"] = {}
    if "overall_summary" not in result:
        result["overall_summary"] = "Assessment completed using AI analysis of CV."

    return result
