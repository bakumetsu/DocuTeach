import struct
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
BLUE = b"\x25\x63\xeb"
WHITE = b"\xff\xff\xff\xff"
TRANSPARENT = b"\x00\x00\x00\x00"


def png_chunk(tag: bytes, data: bytes) -> bytes:
    payload = tag + data
    crc = struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
    return struct.pack(">I", len(data)) + payload + crc


def build_png(size: int) -> bytes:
    center = size / 2.0
    corner_radius = size / 5.0
    margin = size / 2.0 - corner_radius

    d_height = 0.60 * size
    d_outer = d_height / 2.0
    d_bar_width = 0.30 * d_height
    d_width = d_bar_width + d_outer
    d_left = -d_width / 2.0
    d_ring_cx = d_left + d_bar_width
    d_inner = d_outer - 0.14 * size

    rows: list[bytes] = []
    for y_index in range(size):
        y = y_index + 0.5
        row = bytearray(b"\x00")
        for x_index in range(size):
            x = x_index + 0.5
            dx_bg = max(abs(x - center) - margin, 0.0)
            dy_bg = max(abs(y - center) - margin, 0.0)
            if dx_bg * dx_bg + dy_bg * dy_bg > corner_radius * corner_radius:
                row.extend(TRANSPARENT)
                continue

            lx = x - center
            ly = y - center
            in_bar = (
                d_left <= lx <= d_left + d_bar_width
                and -d_outer <= ly <= d_outer
            )
            dx_ring = lx - d_ring_cx
            dist2 = dx_ring * dx_ring + ly * ly
            in_ring = (
                dx_ring >= 0.0
                and d_inner * d_inner <= dist2 <= d_outer * d_outer
            )
            if in_bar or in_ring:
                row.extend(WHITE)
            else:
                row.extend(BLUE)
        rows.append(bytes(row))

    raw = b"".join(rows)
    compressed = zlib.compress(raw)
    ihdr = struct.pack(">2I5B", size, size, 8, 6, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", compressed)
        + png_chunk(b"IEND", b"")
    )


def build_icon(sizes: tuple[int, ...]) -> bytes:
    pngs = [build_png(size) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = bytearray()
    data = bytearray()
    for size, png in zip(sizes, pngs, strict=True):
        dim = 0 if size == 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    return bytes(header + entries + data)


def main() -> None:
    icon = build_icon((16, 32, 48, 256))
    path = Path(__file__).resolve().parent / "icon.ico"
    path.write_bytes(icon)


if __name__ == "__main__":
    main()
