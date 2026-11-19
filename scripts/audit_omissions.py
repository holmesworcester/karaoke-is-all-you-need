"""List possible omissions by comparing a scored recording with an independent timed transcript."""

import argparse
import difflib
import json
import re
import unicodedata
from pathlib import Path


def words(text):
    text = unicodedata.normalize("NFKC", text).casefold().replace("’", "'")
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text)


def candidates(score, observations, *, margin=2600):
    """Times are milliseconds. The score is a list of [start, end, text] rows."""
    lexemes = [
        (a, b, part) for row in score for a, b, text in row for part in words(text)
    ]
    lexemes.sort(key=lambda entry: entry[0])
    result = []
    for start, end, text in observations:
        heard = words(text)
        if not heard:
            continue
        local = [
            (a, b, w)
            for a, b, w in lexemes
            if b >= start - margin and a <= end + margin
        ]
        expected = [w for a, b, w in local]
        blocks = difflib.SequenceMatcher(
            None, heard, expected, autojunk=False
        ).get_matching_blocks()
        prev = 0
        for i, j, size in blocks:
            if i > prev:
                missing = heard[prev:i]
                left = heard[prev - 1] if prev else None
                right = heard[i] if i < len(heard) else None
                result.append(
                    {
                        "start": start,
                        "end": end,
                        "choice": missing,
                        "before": left,
                        "after": right,
                        "phrase": text,
                        "nearby": " ".join(expected),
                        "unscored": not local,
                    }
                )
            prev = i + size
    return result


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("score", type=Path)
    cli.add_argument(
        "observations", type=Path, help="Independent [startMs,endMs,text] observations"
    )
    cli.add_argument("output", type=Path)
    args = cli.parse_args()
    report = candidates(
        json.loads(args.score.read_text()), json.loads(args.observations.read_text())
    )
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
