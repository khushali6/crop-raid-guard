"""Outbound notifications (Telegram, WhatsApp) with deterministic, translated alert templates."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

SPECIES_NAMES = {
    "hi": {
        "wild_boar": "जंगली सूअर", "nilgai": "नीलगाय", "spotted_deer": "चीतल हिरण", "sambar": "सांभर",
        "blackbuck": "काला हिरण", "asian_elephant": "हाथी", "rhesus_macaque": "बंदर", "bonnet_macaque": "बंदर",
        "primate": "बंदर", "langur": "लंगूर", "indian_peafowl": "मोर", "porcupine": "साही", "golden_jackal": "सियार",
        "deer": "हिरण", "bird": "पक्षी", "animal": "जानवर", "wild_bovid": "नीलगाय जैसा जानवर",
    },
    "gu": {
        "wild_boar": "જંગલી ભૂંડ", "nilgai": "નીલગાય", "spotted_deer": "ચિતલ હરણ", "sambar": "સાબર",
        "blackbuck": "કાળિયાર", "asian_elephant": "હાથી", "rhesus_macaque": "વાંદરો", "bonnet_macaque": "વાંદરો",
        "primate": "વાંદરો", "langur": "વાંદરો (લંગૂર)", "indian_peafowl": "મોર", "porcupine": "શાહુડી",
        "golden_jackal": "શિયાળ", "deer": "હરણ", "bird": "પક્ષી", "animal": "પ્રાણી", "wild_bovid": "નીલગાય જેવું પ્રાણી",
    },
}
BAND_NAMES = {
    "en": {"High": "High", "Moderate": "Moderate", "Low": "Low"},
    "hi": {"High": "उच्च", "Moderate": "मध्यम", "Low": "कम"},
    "gu": {"High": "ઊંચું", "Moderate": "મધ્યમ", "Low": "ઓછું"},
}
TEMPLATES = {
    "en": {
        "title": "{species} activity at {farm}",
        "title_repeat": "Repeated {species} activity at {farm}",
        "body": "{species} seen at {farm} at {time} ({conf}% sure). Crop-raid risk: {band} ({score}/100).",
        "repeat": " This is visit {n} in the last 7 days.",
        "cta": "Open the evidence to confirm it, then prepare a claim if crops were damaged. "
               "PMFBY wild-animal losses must be reported within 72 hours.",
        "analysis_done": "Your video \"{title}\" is ready: {events} wildlife event(s) found.",
    },
    "hi": {
        "title": "{farm} में {species} की गतिविधि",
        "title_repeat": "{farm} में {species} बार-बार आ रहे हैं",
        "body": "{farm} में {time} बजे {species} दिखा ({conf}% निश्चित)। फसल नुकसान का जोखिम: {band} ({score}/100)।",
        "repeat": " पिछले 7 दिनों में यह {n}वीं बार है।",
        "cta": "सबूत खोलकर पुष्टि करें। फसल को नुकसान हुआ हो तो दावा तैयार करें — PMFBY में जंगली जानवरों से नुकसान की "
               "सूचना 72 घंटे के भीतर देनी होती है।",
        "analysis_done": "आपका वीडियो \"{title}\" तैयार है: {events} वन्यजीव घटनाएँ मिलीं।",
    },
    "gu": {
        "title": "{farm} માં {species} ની હિલચાલ",
        "title_repeat": "{farm} માં {species} વારંવાર આવે છે",
        "body": "{farm} માં {time} વાગ્યે {species} જોવા મળ્યું ({conf}% ખાતરી). પાક નુકસાનનું જોખમ: {band} ({score}/100).",
        "repeat": " છેલ્લા 7 દિવસમાં આ {n}મી મુલાકાત છે.",
        "cta": "પુરાવો ખોલીને ખાતરી કરો. પાકને નુકસાન થયું હોય તો દાવો તૈયાર કરો — PMFBY માં જંગલી પ્રાણીથી થયેલા નુકસાનની "
               "જાણ 72 કલાકમાં કરવી પડે છે.",
        "analysis_done": "તમારો વીડિયો \"{title}\" તૈયાર છે: {events} વન્યજીવ ઘટનાઓ મળી.",
    },
}


def species_name(key: str, common: str, lang: str) -> str:
    return SPECIES_NAMES.get(lang, {}).get(key, common)


def alert_text(
    *, lang: str, species_key: str, common: str, farm: str, local_time: datetime, conf: float, band: str, score: int, visits: int
) -> tuple[str, str]:
    t = TEMPLATES.get(lang, TEMPLATES["en"])
    name = species_name(species_key, common, lang)
    title = (t["title_repeat"] if visits >= 2 else t["title"]).format(species=name, farm=farm)
    body = t["body"].format(
        species=name, farm=farm, time=local_time.strftime("%I:%M %p").lstrip("0"), conf=int(round(conf * 100)),
        band=BAND_NAMES.get(lang, BAND_NAMES["en"])[band], score=score,
    )
    if visits >= 2:
        body += t["repeat"].format(n=visits + 1)
    return title, body


def cta_text(lang: str) -> str:
    return TEMPLATES.get(lang, TEMPLATES["en"])["cta"]


def analysis_done_text(lang: str, title: str, events: int) -> str:
    return TEMPLATES.get(lang, TEMPLATES["en"])["analysis_done"].format(title=title, events=events)


async def telegram_call(method: str, payload: dict[str, Any] | None = None, files: dict | None = None) -> dict:
    token = get_settings().telegram_bot_token
    if not token:
        return {"ok": False, "description": "telegram not configured"}
    async with httpx.AsyncClient(timeout=30) as http:
        if files:
            resp = await http.post(f"https://api.telegram.org/bot{token}/{method}", data=payload or {}, files=files)
        else:
            resp = await http.post(f"https://api.telegram.org/bot{token}/{method}", json=payload or {})
    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"ok": False}
    if not data.get("ok"):
        log.warning("telegram %s failed: %s", method, data.get("description"))
    return data


async def telegram_send(chat_id: int, text: str, buttons: list[list[dict]] | None = None, photo: bytes | None = None) -> bool:
    markup = {"inline_keyboard": buttons} if buttons else None
    if photo:
        import json as _json

        payload: dict[str, Any] = {"chat_id": str(chat_id), "caption": text[:1000]}
        if markup:
            payload["reply_markup"] = _json.dumps(markup)
        data = await telegram_call("sendPhoto", payload, files={"photo": ("evidence.jpg", photo, "image/jpeg")})
    else:
        payload = {"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True}
        if markup:
            payload["reply_markup"] = markup
        data = await telegram_call("sendMessage", payload)
    return bool(data.get("ok"))


async def whatsapp_send_text(to: str, text: str) -> bool:
    s = get_settings()
    if not (s.whatsapp_token and s.whatsapp_phone_number_id):
        return False
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            f"https://graph.facebook.com/v21.0/{s.whatsapp_phone_number_id}/messages",
            headers={"Authorization": f"Bearer {s.whatsapp_token}"},
            json={"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": text[:4000]}},
        )
    if resp.status_code >= 300:
        log.warning("whatsapp send failed: %s", resp.text[:200])
    return resp.status_code < 300
