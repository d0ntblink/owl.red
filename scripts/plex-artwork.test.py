import ast
import hashlib
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import yaml
from ruamel.yaml import YAML


REPOSITORY = Path(__file__).resolve().parents[1]
SOURCE = yaml.safe_load((REPOSITORY / "gitops/kometa/config.yaml").read_text())["data"]
TREE = ast.parse(SOURCE["run.py"])
NAMESPACE = {"Path": Path, "hashlib": hashlib, "os": os, "sys": sys, "tempfile": tempfile, "YAML": YAML}
DEFINITIONS = [node for node in TREE.body if isinstance(node, (ast.Assign, ast.FunctionDef))]
exec(compile(ast.Module(body=DEFINITIONS, type_ignores=[]), "embedded-run.py", "exec"), NAMESPACE)


def episode(filename, key="1"):
    return SimpleNamespace(ratingKey=key, media=[SimpleNamespace(parts=[SimpleNamespace(file=str(filename))])])


class ArtworkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.season = self.root / "Example" / "Season 01"
        self.season.mkdir(parents=True)
        self.video = self.season / "Example S01E01.mkv"
        self.video.write_bytes(b"video must remain unchanged")

    def test_distinct_episodes_share_a_season_without_sharing_artwork(self):
        second = self.season / "Example S01E02.mkv"
        second.write_bytes(b"second video")
        planned, pending = NAMESPACE["plan"]([episode(self.video), episode(second, "2")], self.root, "episode")
        self.assertFalse(pending)
        self.assertEqual([item["poster"].name for item in planned], ["Example S01E01-thumb.jpg", "Example S01E02-thumb.jpg"])

    def test_shared_video_and_multipart_episodes_are_refused(self):
        planned, pending = NAMESPACE["plan"]([episode(self.video), episode(self.video, "2")], self.root, "episode")
        self.assertFalse(planned)
        self.assertEqual(len(pending), 2)
        item = episode(self.video)
        item.media[0].parts.append(SimpleNamespace(file=str(self.video)))
        planned, pending = NAMESPACE["plan"]([item], self.root, "episode")
        self.assertFalse(planned)
        self.assertTrue(pending)

    def test_symlinked_video_folder_and_artwork_are_refused(self):
        linked_video = self.season / "linked.mkv"
        linked_video.symlink_to(self.video)
        linked_folder = self.root / "linked"
        linked_folder.symlink_to(self.season, target_is_directory=True)
        target = self.season / "Example S01E01-thumb.jpg"
        target.symlink_to(self.video)
        for filename in [linked_video, linked_folder / self.video.name, self.video]:
            with self.subTest(filename=filename):
                planned, pending = NAMESPACE["plan"]([episode(filename)], self.root, "episode")
                self.assertFalse(planned)
                self.assertTrue(pending)

    def test_outside_root_is_refused_and_portrait_planning_survives(self):
        planned, pending = NAMESPACE["plan"]([episode(self.video)], self.season, "episode")
        self.assertFalse(planned)
        self.assertTrue(pending)
        show = SimpleNamespace(ratingKey="1", locations=[str(self.root / "Example")])
        planned, pending = NAMESPACE["plan"]([show], self.root, "show")
        self.assertFalse(pending)
        self.assertEqual(planned[0]["poster"], self.root / "Example/poster.jpg")

    def test_only_artwork_changes_and_artwork_drift_is_refused(self):
        target = self.season / "Example S01E01-thumb.jpg"
        source = self.root / "finished.jpg"
        source.write_bytes(b"new artwork")
        NAMESPACE["replace_poster"](target, source, None)
        self.assertEqual(target.read_bytes(), b"new artwork")
        self.assertEqual(self.video.read_bytes(), b"video must remain unchanged")
        with self.assertRaises(RuntimeError):
            NAMESPACE["replace_poster"](target, source, None)

    def test_media_changes_are_detectable_before_export(self):
        before, pending = NAMESPACE["plan"]([episode(self.video)], self.root, "episode")
        self.assertFalse(pending)
        self.video.write_bytes(b"changed media")
        after, pending = NAMESPACE["plan"]([episode(self.video)], self.root, "episode")
        self.assertNotEqual(before[0]["media_before"], after[0]["media_before"])

    def test_thumbnail_requires_landscape_jpeg(self):
        NAMESPACE["validate_artwork"](SimpleNamespace(format="JPEG", width=1000, height=563), "episode")
        for image in [SimpleNamespace(format="JPEG", width=1000, height=1500), SimpleNamespace(format="PNG", width=1000, height=563)]:
            with self.assertRaises(RuntimeError):
                NAMESPACE["validate_artwork"](image, "episode")

    def test_library_sources_and_rating_scope(self):
        base = self.root / "config.yml"
        base.write_text(SOURCE["config.yml"])
        configuration = NAMESPACE["load_configuration"](base, REPOSITORY / "gitops/kometa/libraries")
        self.assertEqual(set(configuration["libraries"]), set(NAMESPACE["MEDIA_ROOTS"]))
        self.assertEqual(configuration["settings"]["playlist_sync_to_users"], [])
        for name, library in configuration["libraries"].items():
            ratings = library["overlay_files"][0]["template_variables"]
            self.assertEqual(ratings["rating1"], "mdb_tomatoes")
            self.assertEqual(ratings["rating2"], "imdb" if "Shows" in name else "mdb_letterboxd")
            self.assertNotIn("rating3", ratings)
        configuration["libraries"]["Movies"]["settings"]["asset_directory"] = "changed"
        self.assertEqual(configuration["libraries"]["4K Movies"]["settings"]["asset_directory"], "/assets/4K Movies")
        with self.assertRaises(FileNotFoundError):
            NAMESPACE["load_configuration"](base, self.root / "missing")

    def test_playlists_run_once_after_libraries_and_not_for_overlay_only(self):
        for overlay_only in [False, True]:
            with self.subTest(overlay_only=overlay_only):
                base = self.root / "config.yml"
                base.write_text(SOURCE["config.yml"])
                def mapped_path(value):
                    return {"/config/config.yml": base, "/libraries": REPOSITORY / "gitops/kometa/libraries"}.get(str(value), Path(value))
                def library_run(server, name, arguments):
                    self.assertNotIn("playlist_files", YAML(typ="safe").load(base.read_text()))
                runner, native = Mock(side_effect=library_run), Mock()
                arguments = ["run.py", "--run", "--read-only-config", "--no-missing", "--libraries", "Movies|4K Movies|Shows|4K Shows"]
                if overlay_only:
                    arguments.append("--overlays-only")
                with patch.dict(NAMESPACE, {"Path": mapped_path, "PlexServer": Mock(), "run_library": runner, "subprocess": SimpleNamespace(run=native)}):
                    with patch.object(sys, "argv", arguments), patch.dict(os.environ, {"KOMETA_PLEXTOKEN": "synthetic-test-only"}):
                        NAMESPACE["main"]()
                self.assertEqual(runner.call_count, 4)
                self.assertEqual(native.call_count, 0 if overlay_only else 1)
                if not overlay_only:
                    self.assertIn("--playlists-only", native.call_args.args[0])
                    self.assertNotIn("--libraries", native.call_args.args[0])


if __name__ == "__main__":
    unittest.main()