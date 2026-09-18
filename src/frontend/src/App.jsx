import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout.jsx";
import { EmptyState } from "./components/states.jsx";
import { OverviewScreen } from "./screens/OverviewScreen.jsx";
import { DisruptionsScreen } from "./screens/DisruptionsScreen.jsx";
import { AffectedShipmentsScreen } from "./screens/AffectedShipmentsScreen.jsx";
import { ShipmentDetailScreen } from "./screens/ShipmentDetailScreen.jsx";
import { AlternativesScreen } from "./screens/AlternativesScreen.jsx";
import { FleetScreen } from "./screens/FleetScreen.jsx";
import { RedeploymentScreen } from "./screens/RedeploymentScreen.jsx";
import { ColdChainScreen } from "./screens/ColdChainScreen.jsx";
import { TemperatureHistoryScreen } from "./screens/TemperatureHistoryScreen.jsx";
import { ExcursionDetailScreen } from "./screens/ExcursionDetailScreen.jsx";
import { SensorHealthScreen } from "./screens/SensorHealthScreen.jsx";
import { RiskExplanationScreen } from "./screens/RiskExplanationScreen.jsx";
import { BobChatScreen } from "./screens/BobChatScreen.jsx";
import { CommanderScreen } from "./screens/CommanderScreen.jsx";
import { AuditScreen } from "./screens/AuditScreen.jsx";

export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<OverviewScreen />} />
          <Route path="/disruptions" element={<DisruptionsScreen />} />
          <Route path="/disruptions/:id/affected" element={<AffectedShipmentsScreen />} />
          <Route path="/shipments/:id" element={<ShipmentDetailScreen />} />
          <Route path="/shipments/:id/alternatives" element={<AlternativesScreen />} />
          <Route path="/shipments/:id/redeployment" element={<RedeploymentScreen />} />
          <Route path="/shipments/:id/temperature" element={<TemperatureHistoryScreen />} />
          <Route path="/shipments/:id/risk" element={<RiskExplanationScreen />} />
          <Route path="/fleet" element={<FleetScreen />} />
          <Route path="/coldchain" element={<ColdChainScreen />} />
          <Route path="/excursions/:id" element={<ExcursionDetailScreen />} />
          <Route path="/sensors" element={<SensorHealthScreen />} />
          <Route path="/chat" element={<BobChatScreen />} />
          <Route path="/commander" element={<CommanderScreen />} />
          <Route path="/audit" element={<AuditScreen />} />
          <Route
            path="*"
            element={<EmptyState title="Screen not found" message="Use the navigation to reach a dashboard screen." />}
          />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
