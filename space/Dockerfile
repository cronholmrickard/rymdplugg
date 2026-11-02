FROM python:3.12-slim

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ladda ner modellen när imagen byggs så att en kall start går snabbare.
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('KlangAI/pianissimo-sv-onnx', allow_patterns=['*int8.onnx','nemo128.onnx','vocab.txt','config.json','tokenizer.model','*.py'])"

COPY --chown=user app.py .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
