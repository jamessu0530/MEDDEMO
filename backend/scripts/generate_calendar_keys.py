"""產生行事曆的加密與 Web Push 金鑰；由管理員存入部署 Secret。"""

import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec

if __name__ == "__main__":
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    print("CALENDAR_ENCRYPTION_KEY=" + Fernet.generate_key().decode())
    print("CALENDAR_VAPID_PRIVATE_KEY=" + base64.urlsafe_b64encode(private).decode().rstrip("="))
    print("CALENDAR_VAPID_SUBJECT=mailto:請填管理員Email")
