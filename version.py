# -*- coding: utf-8 -*-
"""앱 버전. 여기 한 곳에서만 정한다.

릴리스 태그(v2.4.0)와 같아야 한다 - GitHub Actions(.github/workflows/release.yml)가
태그를 받으면 tools/check_version.py 로 먼저 맞춰 보고, 다르면 빌드하지 않는다.
자동 업데이트(updater.py)는 이 값과 최신 릴리스의 태그를 견준다.
"""
VERSION = "2.4.0"
