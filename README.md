# Rymdplugg

Övningsapp inför NO-provet i åk 6 om solsystemet och Vintergatan. Byggd för mobilen, med en fråga i taget.
Begrepp, Vem är jag? och resonemangsfrågorna besvaras med rösten.

**Appen:** https://cronholmrickard.github.io/rymdplugg/

## Built with Pianissimo

Röstsvaren görs om till text av [Klang Pianissimo](https://huggingface.co/KlangAI/pianissimo-sv),
svensk taligenkänning från Klang AI AB (CC BY 4.0). Modellen körs i ONNX int8-versionen
([KlangAI/pianissimo-sv-onnx](https://huggingface.co/KlangAI/pianissimo-sv-onnx)) i ett Hugging Face Space,
med ordförstärkning för kapitlets namn och begrepp (Merkurius, Kepler, ljusår, Andromeda …).

## Delar

- `web/`: den statiska appen (HTML, CSS, JS utan byggsteg), publiceras på GitHub Pages.
  Frågorna finns i `web/data.js`.
- `space/`: taligenkänningen, ett Docker-Space på Hugging Face (`KlangRickard/rymdplugg-asr`).
  `POST /transcribe` tar WAV 16 kHz mono och svarar med `{"text": "..."}`. Inget ljud sparas.

Appen spelar in med MediaRecorder, gör om ljudet till 16 kHz mono WAV i webbläsaren och skickar det till Spacet.
Svaren rättas genom att leta efter nyckelord för varje punkt i ett bra svar, och sedan bedömer eleven själv.
Framsteg sparas bara i telefonen (localStorage).

## Köra lokalt

```sh
cd space && uv venv && uv pip install -r requirements.txt && .venv/bin/uvicorn app:app --port 7860
cd web && python3 -m http.server 8000   # appen använder localhost:7860 när den körs på localhost
```
