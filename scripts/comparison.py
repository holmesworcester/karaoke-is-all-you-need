"""Pack sample-aligned karaoke and original stereo pairs into one browser comparison stream."""
import argparse
import subprocess
from pathlib import Path

def build(karaoke, original, dest, offset=0.0):
    # Both inputs must use the same musical clock. Positive offset trims the original.
    cmd = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(karaoke)]
    if offset > 0:
        cmd += ['-ss', str(offset)]
    cmd += ['-i', str(original)]
    def stereo(index):
        return f'[{index}:a:0]aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS'
    length = subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0',
                                     '-show_entries','stream=duration','-of','csv=p=0',str(karaoke)],text=True).strip()
    if length in ('', 'N/A'):
        length = subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration',
                                          '-of','csv=p=0',str(karaoke)],text=True).strip()
    delay = f',adelay={round(-offset * 44100)}S:all=1' if offset < 0 else ''
    graph = (stereo(0) + '[kara];' + stereo(1) + delay + ',apad[orig];'
             '[kara][orig]join=inputs=2:channel_layout=quad:map=0.0-FL|0.1-FR|1.0-BL|1.1-BR[out]')
    cmd += ['-filter_complex_threads','1','-filter_complex',graph]
    if dest.suffix == '.mp4':
        cmd += ['-map','0:v:0','-c:v','copy','-map_chapters','0']
    cmd += ['-map','[out]','-t',length,'-c:a','aac','-b:a','448k','-movflags','+faststart',str(dest)]
    subprocess.run(cmd, check=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('karaoke',type=Path)
    parser.add_argument('original',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--offset',type=float,default=0)
    args=parser.parse_args()
    build(args.karaoke,args.original,args.output,args.offset)
