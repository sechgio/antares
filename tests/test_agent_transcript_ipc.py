import json
from pathlib import Path

import jsonschema
import pytest


def test_agent_transcript_page_and_search_bound_their_inputs():
    catalog = Path(__file__).resolve().parent.parent / "shared" / "ipc-method-catalog.json"
    methods = json.loads(catalog.read_text(encoding="utf-8"))["methods"]
    page = methods["agent_messages_page"]["inputSchema"]
    search = methods["agent_messages_search"]["inputSchema"]
    origin = methods["agent_message_origin"]["inputSchema"]
    jsonschema.validate({"session_id": "s1"}, page)
    jsonschema.validate({"session_id": "s1", "before": 42}, page)
    jsonschema.validate({"session_id": "s1", "around": 42}, page)
    jsonschema.validate({"session_id": "s1", "query": "entrega"}, search)
    jsonschema.validate({"session_id": "s1", "kind": "artifact", "ref": "a1"}, origin)
    for value, schema in [
        ({"session_id": "s1", "before": -1}, page),
        ({"before": 42}, page),
        ({"session_id": "s1", "before": 1, "around": 2}, page),
        ({"session_id": "s1", "query": "x" * 201}, search),
        ({"session_id": "s1", "kind": "file", "ref": "a1"}, origin),
    ]:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(value, schema)
