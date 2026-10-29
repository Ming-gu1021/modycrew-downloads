# ModyCrew macOS / Linux 다운로드

모디크루의 맥·Linux 검증판과 설치 안내를 제공하는 배포 저장소입니다.

- 공식 안내: https://mody.ai.kr/modycrew#desktop-downloads
- 파일: 이 저장소의 Releases에 검증을 마친 버전만 게시합니다.
- macOS: Apple Silicon과 Intel을 구분해 DMG를 받습니다.
- Linux x64: Ubuntu 계열은 DEB, 그 외 환경은 AppImage를 선택합니다.

Windows 설치본을 만든 시점의 앱 코드·웹 화면·로그인 설정을 고정하고, 같은 버전으로 macOS 두 CPU와 Linux를 제작합니다. 세 환경의 패키징·앱 화면·PDF 설치와 첫 사용 검사가 모두 통과한 경우에만 다운로드 목록을 갱신합니다. 실패한 빌드는 기존 다운로드를 바꾸지 않습니다.

맥·Linux 파일은 검증판입니다. 맥 서명·공증과 실제 고객 계정·기기 검증은 별도입니다. 설치된 한글·Office를 직접 조작하는 Windows 전용 기능은 해당 운영체제에서 제공되지 않습니다. 포함된 오픈소스 구성요소의 고지는 앱과 배포 자료에 보존합니다.

일반 사용자는 소스 ZIP이나 빌드 도구를 설치할 필요 없이 Releases의 DMG / DEB / AppImage를 사용하면 됩니다.

## 빌드 운영

이 저장소는 승인된 배포 작업에서 전달한 일회성 소스 다운로드 주소와 고정 SHA-256을 검사합니다. 개인 계정 토큰·회사 자료·사용자 데이터는 빌드 입력에 포함하지 않습니다. `npm run installer`가 플랫폼 설치파일을 만들고, 검증 후 게시 작업이 버전별 파일과 `channel.json`을 갱신합니다.
