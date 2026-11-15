#include "sweep_line.hpp"

#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

using causalotel::Interval;
using causalotel::SweepLineCalculator;

namespace {

void expectEqual(std::int64_t actual, std::int64_t expected, const std::string& label) {
    if (actual != expected) {
        std::cerr << label << ": expected " << expected << ", got " << actual << "\n";
        std::exit(1);
    }
}

void expectResult(const Interval& parent, const std::vector<Interval>& children,
                  std::int64_t expectedUnion, std::int64_t expectedSelf,
                  const std::string& label) {
    const auto result = SweepLineCalculator::calculate(parent, children);
    expectEqual(result.childUnionDuration, expectedUnion, label + " child union");
    expectEqual(result.selfTime, expectedSelf, label + " self time");
}

} // namespace

int main() {
    expectResult({0, 100}, {}, 0, 100, "no children");
    expectResult({0, 100}, {{20, 60}}, 40, 60, "single child");
    expectResult({0, 100}, {{10, 20}, {40, 60}}, 30, 70, "disjoint children");
    expectResult({0, 100}, {{10, 60}, {40, 90}}, 80, 20, "overlapping children");
    expectResult({0, 100}, {{10, 90}, {20, 30}, {40, 70}}, 80, 20, "nested children");
    expectResult({0, 100}, {{10, 30}, {30, 50}}, 40, 60, "adjacent children");
    expectResult({0, 100}, {{-50, 25}, {75, 150}}, 50, 50, "clipped children");
    expectResult({100, 0}, {{20, 60}}, 40, 60, "reversed parent");
    expectResult({0, 100}, {{60, 20}}, 40, 60, "reversed child");

    std::cout << "sweep_line_tests passed\n";
    return 0;
}
