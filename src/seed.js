/**
 * Seed data for testing
 * Run: node src/seed.js
 */
const db = require('./database');

async function seed() {
    await db.initDatabase();

    console.log('🌱 Seeding database...');

    // Clear existing data (idempotent — order matters for FK constraints)
    const d = db.getDb();
    d.run('DELETE FROM credentials');
    d.run('DELETE FROM orders');
    d.run('DELETE FROM products');
    d.run('DELETE FROM categories');

    // Add categories
    const cat1 = db.addCategory('Phần mềm', '💻');
    const cat2 = db.addCategory('Giải trí', '🎬');

    // Products with custom credential field configs
    const p1 = db.addProduct('Capcut Pro 35d BHF 13.000đ', 15000, 'tk:mk', 'Dang nhap tren Dien thoai', cat1, [
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'email_password', label: 'Pass email', icon: '📧' },
        { key: 'password', label: 'Pass tài khoản', icon: '🔑' },
    ]);
    const p2 = db.addProduct('ChatGPT Plus 1 tháng', 65000, 'Tài khoản ChatGPT Plus chính chủ', 'Dùng trên trình duyệt', cat1, [
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'password', label: 'Mật khẩu', icon: '🔑' },
    ]);
    const p3 = db.addProduct('Netflix Premium 1 tháng', 45000, 'Tài khoản Netflix Premium chia sẻ', 'Không đổi mật khẩu', cat2, [
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'email_password', label: 'Pass email', icon: '📧' },
        { key: 'password', label: 'Pass Netflix', icon: '🔑' },
    ]);
    const p4 = db.addProduct('Spotify Premium 1 tháng', 25000, 'Tài khoản Spotify Premium', 'Dùng trên điện thoại', cat2, [
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'password', label: 'Mật khẩu', icon: '🔑' },
    ]);

    // Credentials
    const credentials = [
        { productId: p1, data: { username: 'capcut_user1@gmail.com', email_password: 'EmailPass1!', password: 'Pass1234!' } },
        { productId: p1, data: { username: 'capcut_user2@gmail.com', email_password: 'EmailPass2!', password: 'Pass5678!' } },
        { productId: p1, data: { username: 'capcut_user3@gmail.com', email_password: '', password: 'Pass9012!' } },
        { productId: p2, data: { username: 'chatgpt_user1@gmail.com', password: 'GPT1234!' } },
        { productId: p2, data: { username: 'chatgpt_user2@gmail.com', password: 'GPT5678!' } },
        { productId: p2, data: { username: 'chatgpt_user3@gmail.com', password: 'GPT9012!' } },
        { productId: p2, data: { username: 'chatgpt_user4@gmail.com', password: 'GPT3456!' } },
        { productId: p3, data: { username: 'netflix_user1@gmail.com', email_password: 'NFXEmail1!', password: 'NFX1234!' } },
        { productId: p3, data: { username: 'netflix_user2@gmail.com', email_password: 'NFXEmail2!', password: 'NFX5678!' } },
        { productId: p4, data: { username: 'spotify_user1@gmail.com', password: 'SPT1234!' } },
        { productId: p4, data: { username: 'spotify_user2@gmail.com', password: 'SPT5678!' } },
        { productId: p4, data: { username: 'spotify_user3@gmail.com', password: 'SPT9012!' } },
    ];

    for (const cred of credentials) {
        db.addCredential(cred.productId, cred.data);
    }

    // Verify
    const stock = db.getAllProductsStock();
    console.log('\n📊 Stock after seeding:');
    for (const s of stock) {
        console.log(`   ${s.name}: ${s.available} available`);
    }

    console.log('\n✅ Seed completed!');
    db.saveDatabase();
}

seed().catch(console.error);
