"""Answer generation. LLM path uses LangChain; demo path is extractive and labelled as such."""
import re

from .config import settings

NOT_FOUND = "Not found in uploaded documents. The retrieved passages did not contain enough evidence to answer this question."
STOP = set(
    "a an and are as at be by for from has have how i in is it its of on or that the this to was were what when where "
    "which who why will with does do did can could should would about into than then there their they them you your we our".split()
)
MIN_SCORE_DEMO = 0.08
MIN_SCORE_LLM = 0.25


def tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", s.lower()) if len(t) > 1 and t not in STOP}


def extractive(question: str, hits: list[dict]) -> dict:
    q = tokens(question)
    if not q:
        return {"answer": NOT_FOUND, "citations": [], "not_found": True, "mode": "demo-extractive"}
    lines, cites = [], []
    for h in hits:
        if h["score"] < MIN_SCORE_DEMO or len(q & tokens(h["text"])) / len(q) < 0.5:
            continue
        sentences = re.split(r"(?<=[.!?])\s+", h["text"])
        best = max(sentences, key=lambda s: len(q & tokens(s)))
        if not q & tokens(best):
            continue
        cites.append(h)
        lines.append(f"{best.strip()} [{len(cites)}]")
        if len(cites) == 3:
            break
    if not cites:
        return {"answer": NOT_FOUND, "citations": [], "not_found": True, "mode": "demo-extractive"}
    return {"answer": "\n\n".join(lines), "citations": cites, "not_found": False, "mode": "demo-extractive"}


SYSTEM = (
    "You answer questions using ONLY the numbered context passages. Cite every claim with [n] matching the passage "
    "number. If the passages do not contain the answer, reply exactly: NOT_FOUND. Never use outside knowledge."
)


def generate(question: str, hits: list[dict], history: list[dict]) -> dict:
    if settings.demo:
        return extractive(question, hits)
    hits = [h for h in hits if h["score"] >= MIN_SCORE_LLM]
    if not hits:
        return {"answer": NOT_FOUND, "citations": [], "not_found": True, "mode": "llm"}
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    context = "\n\n".join(f"[{i + 1}] (page {h['page']}) {h['text']}" for i, h in enumerate(hits))
    msgs = [SystemMessage(SYSTEM)]
    for m in history[-6:]:
        msgs.append(HumanMessage(m["content"]) if m["role"] == "user" else AIMessage(m["content"]))
    msgs.append(HumanMessage(f"Context:\n{context}\n\nQuestion: {question}"))
    llm = ChatOpenAI(model=settings.openai_chat_model, api_key=settings.openai_api_key, temperature=0)
    text = str(llm.invoke(msgs).content).strip()
    if text.startswith("NOT_FOUND"):
        return {"answer": NOT_FOUND, "citations": [], "not_found": True, "mode": f"llm:{settings.openai_chat_model}"}
    # Keep only passages the model actually cited, renumbered in order of first use.
    used = [int(n) for n in dict.fromkeys(re.findall(r"\[(\d+)\]", text)) if 0 < int(n) <= len(hits)]
    remap = {old: new + 1 for new, old in enumerate(used)}
    text = re.sub(r"\[(\d+)\]", lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else "", text)
    return {"answer": text, "citations": [hits[n - 1] for n in used], "not_found": not used,
            "mode": f"llm:{settings.openai_chat_model}"}