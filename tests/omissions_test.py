import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from audit_omissions import candidates


class ReviewTest(unittest.TestCase):
    def test_final_word_and_extra_retrigger(self):
        score = [[[1000, 1300, "lean"]], [[7000, 7450, "right"], [7600, 8070, "here"]]]
        obs = [[900, 1750, "Lean on."], [6800, 8200, "right right here"]]
        flags = candidates(score, obs, margin=350)
        self.assertEqual([f["choice"] for f in flags], [["on"], ["right"]])

    def test_other_chorus_cannot_supply_missing_word(self):
        score = [[[1000, 1400, "so"]], [[9000, 9500, "so"], [9500, 9950, "strong"]]]
        self.assertEqual(
            candidates(score, [[1000, 1800, "so strong"]])[0]["choice"], ["strong"]
        )

    def test_mixed_scripts_punctuation_and_real_rest(self):
        score = [
            [[1000, 1300, "لأولاد"], [1330, 1750, "عمه"]],
            [[7000, 7800, "self-inflicted"]],
        ]
        obs = [
            [1000, 1600, "لأولاد عمه"],
            [7000, 7900, "Self inflicted!"],
            [14000, 15000, "one more"],
        ]
        flags = candidates(score, obs, margin=500)
        self.assertEqual(len(flags), 1)
        self.assertTrue(flags[0]["unscored"])


if __name__ == "__main__":
    unittest.main()
