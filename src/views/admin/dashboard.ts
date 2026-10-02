export interface DashboardCounts {
  products: number;
  activeProducts: number;
  orders: number;
  users: number;
}

export function adminDashboardPage(counts: DashboardCounts): string {
  return `
  <h1>Admin Dashboard</h1>
  <ul class="stat-grid">
    <li><span class="stat-grid__value">${counts.products}</span><span class="stat-grid__label">Products</span></li>
    <li><span class="stat-grid__value">${counts.activeProducts}</span><span class="stat-grid__label">Active products</span></li>
    <li><span class="stat-grid__value">${counts.orders}</span><span class="stat-grid__label">Orders</span></li>
    <li><span class="stat-grid__value">${counts.users}</span><span class="stat-grid__label">Customers</span></li>
  </ul>
  <nav class="admin-nav">
    <a href="/admin/products">Manage products</a>
    <a href="/admin/orders">Manage orders</a>
    <a href="/admin/admins/new">Create admin account</a>
  </nav>
  `;
}
