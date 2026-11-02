# Rymdplugg

Övningsapp inför NO-provet i åk 6 om solsystemet och Vintergatan. Byggd för mobilen, med en fråga i taget.
Begrepp, Vem är jag? och resonemangsfrågorna besvaras med rösten.

**Appen:** https://cronholmrickard.github.io/rymdplugg/

## Built with Pianissimo

Röstsvaren görs om till text av [Klang Pianissimo](https://huggingface.co/KlangAI/pianissimo-sv),
svensk taligenkänning från Klang AI AB (CC BY 4.0). Modellen körs **helt i webbläsaren**, så ingen server behövs
och inspelningen lämnar aldrig telefonen.

- Vikter: [mrfakename/pianissimo-sv-ONNX](https://huggingface.co/mrfakename/pianissimo-sv-ONNX), en WebGPU-anpassad
  version av Klangs officiella int4-export ([KlangAI/pianissimo-sv-onnx](https://huggingface.co/KlangAI/pianissimo-sv-onnx)).
  Ungefär 530 MB som laddas ner en gång och sparas i webbläsarens cache.
- Motor: bygger på [Pianissimo WebGPU](https://huggingface.co/spaces/mrfakename/pianissimo-sv-webgpu) av mrfakename
  (CC BY 4.0). Encodern körs med onnxruntime-web på WebGPU, eller WASM om WebGPU saknas.
- Tillagt här: Klangs ordförstärkning (phrase boosting) för kapitlets namn och begrepp, som Merkurius, Kepler och ljusår.
  Trädet räknas fram med Klangs `phrase_boost.py` och ligger i `web/asr/boost.json`.

## Delar

- `web/`: hela appen (HTML, CSS, JS utan byggsteg), publiceras på GitHub Pages. Frågorna finns i `web/data.js`.
- `web/asr/`: röstmotorn som körs i en Web Worker.

Svaren rättas genom att leta efter nyckelord för varje punkt i ett bra svar, och sedan bedömer eleven själv.
Framsteg sparas bara i webbläsaren (localStorage).

## Köra lokalt

```sh
cd web && python3 -m http.server 8000
```
