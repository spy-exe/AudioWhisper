import hashlib
import hmac
import time
from audiowhisper_core.config import get_settings

COOKIE = "audiowhisper_session"
SESSION_SECONDS = 12 * 60 * 60


def session_cookie(token):
    expires = str(int(time.time()) + SESSION_SECONDS)
    return expires + "." + hmac.new(token.encode(), expires.encode(), hashlib.sha256).hexdigest()


def valid_session(value):
    token = get_settings().access_token
    if not token or not value:
        return False
    try:
        expires, signature = value.split(".", 1)
        expected = hmac.new(token.encode(), expires.encode(), hashlib.sha256).hexdigest()
        return int(expires) > time.time() and hmac.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False
