Place your TLS certificate pair here:
- server.key (private key)
- server.crt (certificate)

For quick local self-signed (PowerShell OpenSSL assumed installed):
  openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 365 -subj "/CN=localhost"
Then browse using https://<LAN-IP>:3443 (accept warning on self-signed).
