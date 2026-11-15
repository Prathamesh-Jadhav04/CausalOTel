cmake_minimum_required(VERSION 3.20)

if(POLICY CMP0141)
    cmake_policy(SET CMP0141 NEW)
    set(CMAKE_MSVC_DEBUG_INFORMATION_FORMAT
        "$<$<CONFIG:Debug,RelWithDebInfo>:Embedded>")
endif()

project(causalotel_cpp_core LANGUAGES CXX)

# Embed debug symbols in object files on MSVC. This keeps native builds
# independent of the machine-wide PDB service and avoids linker-time PDB
# contention in constrained build environments.
if(MSVC)
    add_compile_options(/Z7)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include_directories(include)

add_executable(sweep_line src/main.cpp)

include(CTest)
if(BUILD_TESTING)
    add_executable(sweep_line_tests test/sweep_line_tests.cpp)
    target_include_directories(sweep_line_tests PRIVATE include)
    add_test(NAME sweep_line_tests COMMAND sweep_line_tests)
endif()
