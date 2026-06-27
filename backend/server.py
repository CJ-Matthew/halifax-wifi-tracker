import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error

from .api_routes import (
    handle_get_connected_registered_devices,
    handle_get_devices,
    handle_get_eero_debug,
    handle_get_logs,
    handle_get_registered_devices,
    handle_patch_registered_device,
    handle_post_eero_login,
    handle_post_eero_verify,
    handle_post_registered_devices,
    read_json_request,
)
from . import presence_logger
from .supabase_devices import load_env_file


def _cors_origin():
    return os.getenv("ALLOWED_ORIGIN", "*")


def _api_key_valid(headers):
    expected = os.getenv("API_KEY")
    if not expected:
        return True  # no key configured — allow all (local dev)
    return headers.get("X-API-Key", "") == expected


class WifiApiHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        response_body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Access-Control-Allow-Origin", _cors_origin())
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()
        self.wfile.write(response_body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", _cors_origin())
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if not _api_key_valid(self.headers):
            self._send_json(401, {"error": "Unauthorized"})
            return
        try:
            if self.path in {"/devices", "/devices/"}:
                status_code, payload = handle_get_devices()
            elif self.path in {"/registered-devices", "/registered-devices/", "/regsistered-devices", "/regsistered-devices/"}:
                status_code, payload = handle_get_registered_devices()
            elif self.path in {"/connected", "/connected/"}:
                status_code, payload = handle_get_connected_registered_devices()
            elif self.path in {"/logs", "/logs/"}:
                status_code, payload = handle_get_logs()
            elif self.path in {"/eero/debug", "/eero/debug/"}:
                status_code, payload = handle_get_eero_debug()
            else:
                status_code, payload = 404, {"error": "Not found"}

            self._send_json(status_code, payload)
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(error_body)
            except json.JSONDecodeError:
                payload = {"error": error_body}
            self._send_json(exc.code, payload)
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

    def do_PATCH(self):
        if not _api_key_valid(self.headers):
            self._send_json(401, {"error": "Unauthorized"})
            return
        try:
            payload = read_json_request(self)

            if self.path in {"/registered-devices", "/registered-devices/", "/regsistered-devices", "/regsistered-devices/"}:
                status_code, response_payload = handle_patch_registered_device(payload)
            else:
                self._send_json(404, {"error": "Not found"})
                return

            self._send_json(status_code, response_payload)
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(error_body)
            except json.JSONDecodeError:
                payload = {"error": error_body}
            self._send_json(exc.code, payload)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON"})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

    def do_POST(self):
        if not _api_key_valid(self.headers):
            self._send_json(401, {"error": "Unauthorized"})
            return
        try:
            payload = read_json_request(self)

            if self.path in {"/registered-devices", "/registered-devices/", "/regsistered-devices", "/regsistered-devices/"}:
                status_code, response_payload = handle_post_registered_devices(payload)
            elif self.path in {"/eero/login", "/eero/login/"}:
                status_code, response_payload = handle_post_eero_login(payload)
            elif self.path in {"/eero/verify", "/eero/verify/"}:
                status_code, response_payload = handle_post_eero_verify(payload)
            else:
                self._send_json(404, {"error": "Not found"})
                return

            self._send_json(status_code, response_payload)
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(error_body)
            except json.JSONDecodeError:
                payload = {"error": error_body}
            self._send_json(exc.code, payload)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON"})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


def main():
    load_env_file()
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    presence_logger.start()

    server = ThreadingHTTPServer((host, port), WifiApiHandler)
    print(f"Serving on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()