#include "sweep_line.hpp"
#include <iostream>
#include <string>
#include <sstream>
#include <regex>

/**
 * Lightweight JSON parser for standard IPC without third-party header requirements.
 * Input format: { "parent": { "start": 100, "end": 500 }, "children": [ { "start": 120, "end": 200 } ] }
 */
int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(nullptr);

    std::stringstream buffer;
    buffer << std::cin.rdbuf();
    std::string input = buffer.str();

    if (input.empty()) {
        std::cerr << "Error: Empty input payload\n";
        return 1;
    }

    causalotel::Interval parent{0, 0};
    std::vector<causalotel::Interval> children;

    // Parse parent
    std::regex parentRegex(R"re("parent"\s*:\s*\{\s*"start"\s*:\s*(-?\d+)\s*,\s*"end"\s*:\s*(-?\d+)\s*\})re");
    std::smatch parentMatch;
    if (std::regex_search(input, parentMatch, parentRegex)) {
        parent.start = std::stoll(parentMatch[1].str());
        parent.end = std::stoll(parentMatch[2].str());
    } else {
        std::cerr << "Error: Invalid or missing parent interval\n";
        return 1;
    }

    // Parse children
    std::regex childRegex(R"re(\{\s*"start"\s*:\s*(-?\d+)\s*,\s*"end"\s*:\s*(-?\d+)\s*\})re");
    auto childrenStart = input.find("\"children\"");
    if (childrenStart != std::string::npos) {
        std::string childrenSub = input.substr(childrenStart);
        auto words_begin = std::sregex_iterator(childrenSub.begin(), childrenSub.end(), childRegex);
        auto words_end = std::sregex_iterator();

        for (std::sregex_iterator i = words_begin; i != words_end; ++i) {
            std::smatch match = *i;
            int64_t cs = std::stoll(match[1].str());
            int64_t ce = std::stoll(match[2].str());
            children.push_back({cs, ce});
        }
    }

    auto result = causalotel::SweepLineCalculator::calculate(parent, children);

    // Write JSON response
    std::cout << "{\n"
              << "  \"parentDuration\": " << result.parentDuration << ",\n"
              << "  \"childUnionDuration\": " << result.childUnionDuration << ",\n"
              << "  \"selfTime\": " << result.selfTime << ",\n"
              << "  \"mergedIntervals\": [\n";

    for (size_t i = 0; i < result.mergedIntervals.size(); ++i) {
        std::cout << "    {\"start\": " << result.mergedIntervals[i].start 
                  << ", \"end\": " << result.mergedIntervals[i].end << "}"
                  << (i + 1 < result.mergedIntervals.size() ? "," : "") << "\n";
    }

    std::cout << "  ]\n}\n";
    return 0;
}
