# 🌐 AETHER BINARY NETWORK

**Das Binäre Internet – Massentauglich, Dezentral, Ultraleicht.**

> Jeder Nutzer steuert exakt **0.3% CPU**, **0.3% RAM**, **0.3% GPU** und **0.3% Bandbreite** bei.
> Kein HTML-Overhead. Kein CSS-Parsing. Kein JavaScript-Interpreter für die Datenübertragung.
> Rein binäre Kommunikation über das `0xAE`-Protokoll.

---

## 🚀 Sofort Starten (One-Click)

### Windows
```powershell
# Rechtsklick auf install.ps1 → "Mit PowerShell ausführen"
# ODER:
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Linux / macOS
```bash
chmod +x install.sh && ./install.sh
```

### Manuell
```bash
npm install
npm start
# → http://localhost:8080
```

---

## 🏗️ Architektur

```
aether-binary-network/
├── src/
│   ├── server.js              # Unified Signaling + Edge Server
│   ├── protocol/
│   │   └── binary-codec.js    # 0xAE Binary Wire Format (MsgPack)
│   ├── swarm/
│   │   ├── kademlia-dht.js    # GDPR-konforme Node-Discovery
│   │   └── role-evaluator.js  # Dynamische Rollenvergabe
│   ├── trust/
│   │   └── zero-trust.js      # PoW Anti-Sybil + Reputation
│   ├── limiter/
│   │   └── resource-governor.js # Harte 0.3% Enforcement
│   └── gpu/                   # (Reserved for native GPU compute)
├── public/
│   ├── index.html             # Minimale UI-Shell
│   ├── styles.css             # Premium Glassmorphism Design
│   ├── client.js              # Browser-Runtime (WebRTC+WebGPU+Binary)
│   └── shaders/
│       ├── parity.wgsl        # RAID-5 XOR Compute Shader
│       └── reedsolomon.wgsl   # GF(2^8) Erasure Coding Shader
├── install.ps1                # Windows One-Click Installer
├── install.sh                 # Linux/macOS Installer
├── package.json
└── LICENSE
```

---

## 🔬 Das Binäre Protokoll (0xAE)

Alle Daten werden **binär** übertragen – kein JSON, kein Text-Parsing.

| Byte 0 | Byte 1 | Payload |
|--------|--------|---------|
| `0xAE` Magic | Type (`0x01`-`0x04`) | MsgPack oder Raw Binary |

**Typen:**
- `0x01` – Control Message (MsgPack-kodiert)
- `0x02` – Media Chunk (Raw Binary + 4-Byte Index Header)
- `0x03` – Parity Data (GPU-berechnete XOR/RS-Daten)
- `0x04` – Trust Signal (Kompaktes Reputations-Update)

---

## ⚡ Resource Governor (0.3% Limit)

Das System erzwingt **hart**, dass kein Node mehr als 0.3% beiträgt:

| Ressource | Limit | Mechanismus |
|-----------|-------|-------------|
| CPU | 0.3% | Budget-Tracker (ms/sec) |
| RAM | 0.3% | Allocation Monitor + GC |
| GPU | 0.3% | Compute Shader Throttle |
| Bandwidth | 0.3% | Sliding Window Throttle |

---

## 🛡️ Zero-Trust Sicherheit

- **Proof-of-Work**: Jeder Node muss SHA-256 Hashcash lösen (Anti-Sybil)
- **Trust Ledger**: Dezentraler Reputations-Score (0-1000)
- **Auto-Isolation**: Nodes unter Score 50 werden automatisch aus dem Netzwerk entfernt
- **DSGVO-konform**: Server speichert niemals GPS, IP oder personenbezogene Daten

---

## 🌍 Swarm Rollen

| Rolle | Emoji | Beitrag |
|-------|-------|---------|
| **Nexus** | 🟣 | Voller Relay + Storage + Compute |
| **Sigma** | 🔵 | GPU Parity-Berechnungen |
| **Alpha** | 🟢 | Standard Data Seeding |
| **Omega** | ⚪ | Consumer (0% Beitrag – inklusive Heuristik) |

---

## 📡 API Endpunkte

| Endpoint | Beschreibung |
|----------|-------------|
| `GET /api/stats` | Live-Statistiken des Swarms |
| `GET /api/protocol` | Protokoll-Spezifikation |

---

## 📜 Lizenz

MIT License – Frei für alle. Ein Geschenk an die Menschheit.

---

*Gebaut mit ❤️ für ein dezentrales, binäres Internet.*
