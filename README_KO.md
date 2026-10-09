# VUA — VRC Ultra Assistant

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md) | 한국어

**VUA(VRC Ultra Assistant)** 는 VRChat 플레이어를 위한 Windows 우선·로컬 우선 시나리오 설치·관리·실행
앱입니다. 시나리오는 목표, 필요한 소프트웨어, 준비·실행·복구 단계를 묶은 것입니다. PC 화면으로 플레이하기,
PICO로 스트리밍하기, 선택한 모듈로 Avatar 편집하기처럼 하고 싶은 일부터 다음 단계를 안내합니다.

## VUA로 할 수 있는 일

### 1. 게임 도우미

> **Materials checked and cleared.**

플레이에 필요한 소프트웨어와 설정을 준비하고 이동, 메뉴, 안전 설정, 기기 사용의 기초를 배웁니다. 사용 목적과 하드웨어에 맞춰 필요한 항목을 설명하고 환경 설치를 안내합니다.

첫 계정 안내는 내장 브라우저에서 공식 가입 페이지를 엽니다. 플레이 경로는 Steam과 VRChat, 제작 경로는 선택적으로 Unity와 BOOTH를 안내합니다. 가입, Steam 라이브러리 추가 및 공식 계정 연결은 사용자가 직접 수행합니다. 업로드에는 정식 VRChat 계정과 New User 이상 등급이 필요하지만, 자격을 얻기 전에도 로컬 Avatar 제작 준비를 진행할 수 있습니다.

선택적 외부 연결은 추적, VR 오버레이, 수면 보조, 녹화 및 방송 도구를 대상으로 합니다. VUA는 독립적으로 설치된 앱을 감지하고 Steam 구매·설치 화면을 안내하며 앱을 실행할 예정입니다. 업데이트는 Steam 또는 업스트림 앱이 관리합니다. 추적 도구에는 설정 안내도 제공하며, PICO 시선 추적은 첫 플레이용 릴리스에 포함합니다. [대상 도구와 지원 범위](docs/development-outline.md#n2-external-gameplay-tools)를 참고하세요.

### 2. Avatar 제작

> **Sugar, spice, and everything nice.**

AMF는 VUA와 함께 설치되는 자체 편집 모듈입니다. 「설정 → 기능 모듈」에서 켜면 편집 메뉴가 표시되며,
이 선택은 기억됩니다. 에셋 라이브러리와 전용 BDL은 AMF가 관리하고, 꺼도 데이터는 유지됩니다.

보유한 소재를 조합하고 선택과 설정을 Recipe에 기록해 공유하며, 다른 사용자는 직접 구한 소재로 이를 재현합니다. 목표는 검사와 통제된 변경을 거쳐 Avatar를 자동 제작하고 결과물을 공식 SDK에 전달하는 것입니다. Recipe에는 참조와 설정만 담으며 유료 소재 자체는 포함하지 않습니다.

## 사용 흐름

목표와 보유한 소재에서 시작하여 계획, 실행 단계와 결과를 확인합니다. Build Record는 제작 단계, 검사 근거와 오류를 모아 수행한 작업과 조치가 필요한 부분을 보여 줍니다.

프로젝트 및 패키지 관리는 Unity 환경과 의존성, VPM 저장소, 패키지 설치·업데이트·제거를 준비합니다. 기존 ALCOM/VCC 프로젝트는 읽기 전용으로 검사하고, 편집은 사용자가 요청해 만든 VUA 관리 사본에서 진행합니다. 최종 로그인과 업로드는 사용자가 VRChat 공식 SDK에서 직접 수행합니다.

## 안전 경계

- VUA는 VRChat Inc.와 제휴하거나 공식 승인을 받은 제품이 아닌 독립적인 서드파티 도우미이며, 문서화된 외부 인터페이스, OSC, 실행 옵션, 필요한 로컬 로그와 문서화된 설정만 사용하고 VRChat 클라이언트 주입·후킹·패치 또는 EAC 우회를 하지 않습니다.
- 첫 계정 안내는 격리된 임시 브라우저 세션을 사용합니다. VUA 앱 기능은 비밀번호를 수집하거나 로그인 Cookie와 토큰을 앱 데이터, 로그 또는 에이전트 컨텍스트로 추출하지 않으며, 첫 제공 범위에서는 VRChat 로그인을 기억하지 않습니다. 이후 웹 정보 읽기와 실험적 로그인 유지 기능은 별도 개발 방향이며 플랫폼 승인을 뜻하지 않습니다. [계정 경계](docs/product-boundary.md#account-onboarding-user-ruling-2026-09-30)를 참조하세요.
- 계정 변경은 사용자가 허용된 절차로 시작해야 하며, VUA가 클라우드에서 계정을 대신 조작하거나 Avatar를 자동으로 대신 업로드하지 않습니다.
- 기능에 필요한 최소 데이터만 기본적으로 로컬에 보관하고 불필요한 친구 활동 추적이나 프로파일링을 만들지 않으며, 유료 소재는 로컬에 두고 공유 Recipe에는 소재 자체를 넣지 않습니다.
- 문서화되지 않은 클라이언트 동작, 숨겨진 설정 및 통제되지 않는 API 자동화는 기본 범위에서 제외되며, 기술 검사 통과는 외형·동작·실사용 안전성을 보장하지 않습니다.

[VRChat Creator Guidelines](https://hello.vrchat.com/creator-guidelines) · [Configuration File](https://docs.vrchat.com/docs/configuration-file)

## 개발 진행 상황

v0.6.0은 최신 소스 태그이며 아직 설치 가능한 결과물은 공개되지 않았습니다(유일한 GitHub Release인 v0.5.0에는 에셋이 없습니다). [N1–N7 개발 순서](docs/development-outline.md)에 따라 환경 설치, 선정된 외부 플레이 보조 도구, 복합 Avatar 제작, Recipe 재현, 소재 관리 점검과 재작업, 복구 및 스크린샷 사용자 가이드가 포함된 Beta 설치 프로그램을 개발합니다.

프로젝트는 앞으로도 오랫동안 Beta 상태를 유지할 것으로 예상합니다. 소개는 제품의 방향이며, 구현과 자동 테스트만으로 전체 실제 기기 흐름의 검증을 의미하지 않습니다. 실제 검증 상태는 [개발 순서](docs/development-outline.md)와 [릴리스 노트](docs/release/)에서 확인해 주세요.

### 현재 제공 상태와 시작 방법

- 아직 설치 가능한 배포물은 공개되지 않았습니다. [v0.6.0 검증 기록 및 제한 사항(중국어)](docs/release/v0.6.0.md)에 최신 태그 상태가 기록되어 있습니다. 위 설명은 제품 방향이며 N1–N7의 검증 완료를 뜻하지 않습니다.
- 스크린샷 사용자 가이드와 검증된 Beta 설치 프로그램은 N7 산출물이며 현재 제공되는 사용 설명서가 아닙니다. 사용 질문은 [Issues](https://github.com/VUA-Project/VUA/issues/new/choose)로 남길 수 있습니다.
- 개발자는 [의존성 설치, 데스크톱 앱 실행 및 검사 선택](apps/desktop/README.md#development-commands)부터 시작하고 [기여 가이드](CONTRIBUTING.md)를 따르면 됩니다.

## 문서

- [문서 가이드](docs/README.md)——작업별 최소 경로
- [제품 경계](docs/product-boundary.md)
- [아키텍처](docs/architecture/system.md)
- [v0.6.0 릴리스 노트(중국어)](docs/release/v0.6.0.md)
- [기여 가이드](CONTRIBUTING.md) · [보안 정책](SECURITY.md)

## 라이선스

VUA는 [Apache-2.0](LICENSE)을 사용합니다. 외부 앱에는 각각의 라이선스가 적용되며, 여기에는 [VRCFaceTracking(Apache-2.0)](https://github.com/benaclejames/VRCFaceTracking/blob/master/LICENSE)과 [Space Calibrator(MIT 본체 및 별도 라이선스의 서드파티 구성 요소)](https://github.com/hyblocker/OpenVR-SpaceCalibrator/blob/develop/LICENSE)도 포함됩니다. 지원 예정인 모든 외부 연결, 저작권과 향후 재배포 조건은 [서드파티 고지](THIRD_PARTY_NOTICES.md)를 참조하세요.

[NOTICE](NOTICE) · [상표 가이드](TRADEMARKS.md)

Copyright 2026 Aran52.
