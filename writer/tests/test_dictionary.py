import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parent.parent/'scripts'/'build_rime_ice.py'
spec=importlib.util.spec_from_file_location('build_rime_ice',SCRIPT)
build=importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class TestDictionary(unittest.TestCase):
    def test_pinyin_and_weights(self):
        raw='''# Rime dictionary\n---\nname: base\n...\n你\tni\t100\n你好\tni hao\t3000\n你好\tni hao\t1200\n长\tchang\t12\n长\tzhang\t20\n# comments\n'''
        assert list(build.parse_lines(raw,'base'))==[
          ('ni','你',100),('nihao','你好',3000),('nihao','你好',1200),('chang','长',12),('zhang','长',20)]
        with tempfile.TemporaryDirectory() as tmp:
            index=build.compile_dict({'base':raw},tmp,minimum=1)
            self.assertEqual(index['pinyinKeys'],4)
            import json
            d=json.loads((Path(tmp)/'rime-ice'/'n.json').read_text())
            self.assertEqual(d['nihao'][0][0],'你好')
            self.assertEqual(d['nihao'][0][1],3000)
    def test_other_symbols_ignored(self):
        raw='---\n...\nAI\tai\t100\n你好\tni hao\t123\n重庆\tchong qing\t456\n'
        keys=[x[0] for x in build.parse_lines(raw,'ext')]
        self.assertEqual(keys,['nihao','chongqing'])

if __name__=='__main__':unittest.main()
