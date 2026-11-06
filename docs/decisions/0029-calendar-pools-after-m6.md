# 0029 Calendar pools are rejected until M6

Status: superseded on 31 October 2026 by 0048, which implements closed-market mode.

Closed-market mode (calendar, closure records, closure settlement) is milestone M6. Until the hook can create
closure records, the factory rejects any config with a non-zero `calendar` (`ConfigOutOfBounds(9)`). The Settler
already implements §8's closure branch (`nextOpen` plus `openDelay`, alpha_c and eps_c, the jump guard), which is
unreachable until M6 and will be tested there. `CalendarMath` is complete and tested now.
