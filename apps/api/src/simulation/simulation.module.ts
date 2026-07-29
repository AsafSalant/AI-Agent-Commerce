import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AgentUnderTest, ShoppingAgentUnderTest } from './agent-under-test';
import { ConversationEvaluatorService } from './conversation-evaluator.service';
import { ConversationSimulatorService } from './conversation-simulator.service';
import { UserSimulatorFactory } from './user-simulator';

/**
 * Test-only harness. Intentionally not imported by `AppModule`: nothing the
 * server serves depends on it, and it should never be reachable over HTTP.
 * Bootstrap it from an eval script or a spec instead.
 */
@Module({
  imports: [AgentModule],
  providers: [
    UserSimulatorFactory,
    ConversationEvaluatorService,
    ConversationSimulatorService,
    { provide: AgentUnderTest, useClass: ShoppingAgentUnderTest },
  ],
  exports: [ConversationSimulatorService, ConversationEvaluatorService, UserSimulatorFactory],
})
export class SimulationModule {}
