"""Regresión M5: un job cuyo target lanza una excepción debe quedar reportado
en el estado del job (result + log + err_count), no morir silenciosamente en el
hilo con solo un traceback en stderr.

Los jobs de conversión atrapan sus propias excepciones dentro del target; este
wrapper es la red de seguridad para cualquier otro tipo de job.
"""

from backend.core.jobs import JobManager


class TestJobCrashReporting:
    def test_job_que_crash_queda_reportado(self) -> None:
        mgr = JobManager(max_concurrent=4)

        def boom(job) -> None:
            raise RuntimeError("boom")

        result = mgr.create_job("crash", {"files": []}, boom, job_id="crash-job")
        assert result["started"]

        job = mgr.get_job("crash-job")
        assert job is not None
        job.thread.join(timeout=5)
        assert not job.thread.is_alive()

        assert job.state.running is False
        assert job.state.err_count >= 1
        assert job.result is not None
        assert job.result["error"] == "RuntimeError: boom"
        assert job.result["cancelled"] is False
        assert any(log["tag"] == "error" for log in job.state.logs)

    def test_job_normal_no_marca_error_ni_result(self) -> None:
        mgr = JobManager(max_concurrent=4)

        def ok(job) -> None:
            with job.state._lock:
                job.state.ok_count = 3

        result = mgr.create_job("ok", {}, ok, job_id="ok-job")
        assert result["started"]

        job = mgr.get_job("ok-job")
        assert job is not None
        job.thread.join(timeout=5)

        assert not job.state.running
        assert job.state.err_count == 0
        assert job.state.ok_count == 3
        # El wrapper no inventa un result: solo lo puebla en caso de crash.
        assert job.result is None
        assert not any(log["tag"] == "error" for log in job.state.logs)
