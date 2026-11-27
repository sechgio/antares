import jsonschema
import pytest

from backend.core.ipc_catalog import input_schema_for


def test_agent_browser_schema_accepts_dynamic_tab_ids():
    schema = input_schema_for("agent_browser")
    for tab in ("agent", "user", "tab-1", "tab-27"):
        jsonschema.validate({"action": "tab", "tab": tab}, schema)
    for tab in ("tab-0", "tab-other", "tab-1\n"):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"action": "tab", "tab": tab}, schema)
