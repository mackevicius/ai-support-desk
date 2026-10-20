import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from retrieval import retrieve


class EmbeddingTrialTests(unittest.TestCase):
    def test_trial_cutoff_does_not_change_the_default_retrieval_cutoff(self):
        articles = [{
            'id': 1,
            'title': 'Playback help',
            'body': 'Restart playback.',
            'embedding': [0.6, 0.8],
        }]

        default = retrieve('playback', articles, 'embeddings', [1, 0])
        stricter = retrieve(
            'playback', articles, 'embeddings', [1, 0], embedding_threshold=0.6,
        )

        self.assertEqual([article['id'] for article in default], [1])
        self.assertEqual(stricter, [])

    def test_trial_cli_calibrates_against_correct_documents_and_unrelated_questions(self):
        payload = {
            'dataset': {
                'articles': [{'id': 4, 'title': 'Display name', 'body': 'Change it in Profile.'}],
                'cases': [{'id': 'nickname', 'question': 'Where can I edit my nickname?', 'expected_id': 4}],
                'negatives': [{'id': 'passport', 'question': 'How do I renew my passport?'}],
            },
            'runs': [
                {
                    'config': {'key': 'minilm', 'model': 'baseline'},
                    'documents': {'4': [1, 0]},
                    'questions': {'nickname': [0, 1]},
                    'negatives': {'passport': [-1, 0]},
                    'measurements': {},
                },
                {
                    'config': {'key': 'bge', 'model': 'candidate'},
                    'documents': {'4': [1, 0]},
                    'questions': {'nickname': [1, 0]},
                    'negatives': {'passport': [0.6, 0.8]},
                    'measurements': {},
                },
            ],
        }
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('embedding_trial.py'))],
            input=json.dumps(payload), text=True, capture_output=True, check=True,
        )
        report = json.loads(result.stdout)
        baseline, candidate = report['models']

        self.assertEqual(baseline['current']['hits'], 0)
        self.assertEqual(candidate['current']['hits'], 1)
        self.assertEqual(candidate['current']['negative_matches'], 1)
        self.assertEqual(candidate['calibrated']['threshold'], 0.6)
        self.assertEqual(candidate['calibrated']['hits'], 1)
        self.assertEqual(candidate['calibrated']['negative_matches'], 0)
        self.assertEqual(candidate['calibrated']['cases'][0]['found_ids'], [4])

    def test_trial_replay_rejects_changed_articles_before_loading_models(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'report.json'
            report.write_text(json.dumps({'dataset': {
                'cases': [], 'negatives': [],
                'fingerprints': {'starter_sha256': 'different-articles'},
            }}))
            result = subprocess.run(
                ['node', '--import', 'tsx', str(root / 'api/scripts/trial-embeddings.ts'), '--replay', str(report)],
                cwd=root, text=True, capture_output=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Starter documents do not match the recorded trial', result.stderr)
        self.assertNotIn('Encoding ', result.stderr)


if __name__ == '__main__':
    unittest.main()