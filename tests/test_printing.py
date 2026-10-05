from __future__ import annotations

import ctypes

import fitz
import pytest

from backend.core import printing


class FakeGdi:
    def __init__(self, fail=""):
        self.calls = []
        self.fail = fail

    def CreateDCW(self, *args):
        self.calls.append(("open", args[1]))
        return 1

    def GetDeviceCaps(self, dc, index):
        return 1000 if index == 8 else 1500

    def SetStretchBltMode(self, *args):
        return 1

    def StartDocW(self, dc, info):
        self.calls.append(("start", info._obj.name))
        return 42

    def StartPage(self, dc):
        self.calls.append(("page",))
        return 1

    def StretchDIBits(self, *args):
        header = args[10]._obj
        assert header.bits == 32 and header.height < 0
        assert len(args[9]) == header.width * -header.height * 4
        assert args[3] <= 1000 and args[4] <= 1500
        self.calls.append(("bitmap", header.width, header.height))
        return 0 if self.fail == "bitmap" else -header.height

    def EndPage(self, dc):
        return 1

    def EndDoc(self, dc):
        self.calls.append(("end",))
        return 0 if self.fail == "end" else 1

    def AbortDoc(self, dc):
        self.calls.append(("abort",))
        return 1

    def DeleteDC(self, dc):
        self.calls.append(("close",))
        return 1


@pytest.fixture
def device(tmp_path, monkeypatch):
    source = tmp_path / "sellado.pdf"
    with fitz.open() as pdf:
        pdf.new_page(width=200, height=300)
        pdf.new_page(width=300, height=200)
        pdf.save(source)
    gdi = FakeGdi()
    monkeypatch.setattr(printing.sys, "platform", "win32")
    monkeypatch.setattr(printing, "list_printers", lambda: [{"name": "Prueba", "default": True}])
    monkeypatch.setattr(printing, "_gdi", lambda: gdi)
    return source, gdi


def test_print_queues_pages_in_copy_order_and_rotates_landscape(device):
    source, gdi = device
    result = printing.print_pdf(str(source), "Prueba", 2)
    assert result == {"queued": True, "job_id": 42, "printer_name": "Prueba", "copies": 2,
                      "pages": 2, "filename": "sellado.pdf"}
    bitmaps = [call for call in gdi.calls if call[0] == "bitmap"]
    assert len(bitmaps) == 4
    assert all(width < -height for _, width, height in bitmaps)
    assert bitmaps[:2] == bitmaps[2:]
    assert gdi.calls[-2:] == [("end",), ("close",)]
    assert ("abort",) not in gdi.calls


@pytest.mark.parametrize("failure", ["bitmap", "end"])
def test_failed_print_aborts_job_and_closes_device(device, failure):
    source, gdi = device
    gdi.fail = failure
    with pytest.raises(ValueError, match="No se pudo"):
        printing.print_pdf(str(source), "Prueba")
    assert gdi.calls[-2:] == [("abort",), ("close",)]


def test_cancel_between_pages_aborts_job(device):
    source, gdi = device
    cancelled = iter([False, False, True])
    with pytest.raises(ValueError, match="cancelada"):
        printing.print_pdf(str(source), "Prueba", cancelled=lambda: next(cancelled))
    assert len([call for call in gdi.calls if call[0] == "page"]) == 1
    assert gdi.calls[-2:] == [("abort",), ("close",)]


@pytest.mark.parametrize("copies", [0, 100, True, 1.5, "2"])
def test_invalid_copies_never_open_printer(device, copies):
    source, gdi = device
    with pytest.raises(ValueError, match="copias"):
        printing.print_pdf(str(source), "Prueba", copies)
    assert gdi.calls == []


def test_missing_printer_never_opens_device(device):
    source, gdi = device
    with pytest.raises(ValueError, match="impresora instalada"):
        printing.print_pdf(str(source), "Desconectada")
    assert gdi.calls == []


def test_printer_enumeration_uses_registry_and_identifies_default(monkeypatch):
    class Spool:
        printers = (printing._PrinterInfo * 2)(printing._PrinterInfo("Uno", None, 0), printing._PrinterInfo("Dos", None, 0))

        def EnumPrintersW(self, flags, name, level, buffer, size, needed, count):
            assert (flags, level) == (6, 4)
            needed._obj.value = ctypes.sizeof(self.printers)
            count._obj.value = 2
            if buffer is not None:
                ctypes.memmove(buffer, self.printers, needed._obj.value)
                return 1
            return 0

        def GetDefaultPrinterW(self, buffer, size):
            size._obj.value = 4
            if buffer is not None:
                buffer.value = "Dos"
                return 1
            return 0

    monkeypatch.setattr(printing.sys, "platform", "win32")
    monkeypatch.setattr(printing, "_spool", Spool)
    assert printing.list_printers() == [{"name": "Uno", "default": False}, {"name": "Dos", "default": True}]


def test_non_windows_does_not_offer_printing(monkeypatch):
    monkeypatch.setattr(printing.sys, "platform", "linux")
    assert printing.list_printers() == []
    with pytest.raises(ValueError, match="Windows"):
        printing.print_pdf("reporte.pdf", "Prueba")
