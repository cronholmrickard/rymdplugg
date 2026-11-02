---
title: Rymdplugg taligenkänning
emoji: 🪐
colorFrom: indigo
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: cc-by-4.0
short_description: Svensk taligenkänning med Klang Pianissimo för Rymdplugg
---

Backend för [Rymdplugg](https://cronholmrickard.github.io/rymdplugg/), en övningsapp i NO för åk 6.

`POST /transcribe` tar emot WAV (16 kHz, mono, 16 bitar, max 90 sekunder) och svarar med `{"text": "..."}`.
Inget ljud sparas.

Taligenkänningen görs av [Klang Pianissimo](https://huggingface.co/KlangAI/pianissimo-sv) av Klang AI AB,
licensierad under CC BY 4.0, i ONNX int8-versionen
[KlangAI/pianissimo-sv-onnx](https://huggingface.co/KlangAI/pianissimo-sv-onnx).
