import { Logger } from '@nestjs/common';

// Several tests deliberately exercise failure paths; muting the Nest logger
// keeps their expected error output from drowning the test report.
Logger.overrideLogger(false);
