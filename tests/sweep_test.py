"""A missing, frozen or invisible last word must fail the same pixel check as a release."""
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "scripts"))
from check_sweep import check

work = root / "build/sweep-test"
work.mkdir(exist_ok=True, parents=True)
script = """[Script Info]
ScriptType: v4.00+
PlayResX: 480
PlayResY: 240
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Lyric,Barlow Condensed,46,&H00FFFFFF,&H00808080,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,0,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
""" + r"""Dialogue: 1,0:00:00.00,0:00:02.50,Lyric,Lead,0,0,0,,{\pos(240,105)\kf70}Hold {\kf115}on
Dialogue: 2,0:00:00.00,0:00:02.50,Lyric,Reply,0,0,0,,{\pos(240,210)\kf200}on
"""
reference = work / "reference.ass"
reference.write_text(script)
for good in [True, False]:
    path = work / "draw.ass"
    path.write_text(script if good else script.replace(r"{\kf115}on", r"{\kf3}on"))
    movie = work / ("held.mp4" if good else "compressed.mp4")
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=480x240:r=25:d=2.5",
        "-vf", f"ass=draw.ass:fontsdir={root / 'assets'}", "-c:v", "libx264", "-threads", "2", movie
    ], cwd=work, check=True)
    first, last = check(movie, reference, "on", .70, 1.85, lane="Lead", fonts=root / "assets")
    assert (last - first > .37) == good, (movie, first, last)
print("Decoded overlapping lanes distinguish a held final word from a three-centisecond cue.")
