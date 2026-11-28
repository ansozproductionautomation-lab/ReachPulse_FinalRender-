import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Navbar from "./Components/Navbar";
import Sidebar from "./Components/Sidebar";

import Dashboard from "./pages/Dashboard";
import TemplateLibraryPage from "./pages/TemplateLibraryPage";
import DefineAudience from "./pages/DefineAudience";
import YourTemplate from "./pages/YourTemplate";
import Inbox from "./pages/Inbox";
import Automation from "./pages/Automation";
import ShopifyCustomers from "./pages/ShopifyCustomers";

const App = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f8f9ff]">

        {/* TOP NAVBAR */}
        <Navbar />

        {/* LEFT SIDEBAR */}
        <Sidebar />

        {/* PAGE CONTENT */}
        <main className="ml-[220px] min-w-0 pt-[72px]">
          <Routes>

            {/* Homepage */}
            <Route
              path="/"
              element={<Navigate to="/dashboard" replace />}
            />

            {/* Handle Render index.html route */}
            <Route
              path="/index.html"
              element={<Navigate to="/dashboard" replace />}
            />

            {/* Dashboard */}
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Inbox */}
            <Route path="/inbox" element={<Inbox />} />

            {/* Template Library */}
            <Route path="/templates" element={<TemplateLibraryPage />} />

            {/* Contacts */}
            <Route path="/contacts" element={<DefineAudience />} />

            {/* Your Templates */}
            <Route path="/yourtemplates" element={<YourTemplate />} />

            {/* Automation */}
            <Route path="/automation" element={<Automation />} />

            {/* Shopify Customers */}
            <Route path="/shopify-customers" element={<ShopifyCustomers />} />

            {/* Unknown routes */}
            <Route
              path="*"
              element={<Navigate to="/dashboard" replace />}
            />

          </Routes>
        </main>

      </div>
    </BrowserRouter>
  );
};

export default App;