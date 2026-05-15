import { useState, useEffect } from 'react'
import './index.css'

function App() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('payplus') // 'payplus' or 'stripe'

  useEffect(() => {
    // Fetch products from backend
    fetch('https://custom-ecommerce-qp30.onrender.com/api/products')
      .then(res => res.json())
      .then(data => setProducts(data))
      .catch(err => console.error("Failed to load products", err))
  }, [])

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
    } else {
      setCart([...cart, { ...product, quantity: 1 }])
    }
    setIsCartOpen(true)
  }

  const cartTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0)

  const checkout = async () => {
    try {
      const endpoint = paymentMethod === 'stripe' ? '/api/checkout/stripe' : '/api/checkout/payplus';
      const response = await fetch(`https://custom-ecommerce-qp30.onrender.com${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Yohanan Test',
          customerEmail: 'yohanan@example.com',
          address: 'Dizengoff 99, Tel Aviv',
          items: cart,
          totalAmount: cartTotal
        })
      });
      const data = await response.json();
      if (data.success && data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        alert('Checkout initialization failed.');
      }
    } catch (error) {
      console.error(error);
      alert('Checkout failed due to a network error.');
    }
  }

  const path = window.location.pathname;

  if (path === '/success') {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '100px 20px' }}>
        <h1 style={{ fontSize: '48px', marginBottom: '24px' }}>Payment Successful! 🎉</h1>
        <p style={{ fontSize: '20px', color: '#888', marginBottom: '32px' }}>
          Thank you for your order. We're processing it now and you'll receive a confirmation email shortly.
        </p>
        <button className="checkout-btn" style={{ maxWidth: '250px' }} onClick={() => window.location.href = '/'}>
          Return to Store
        </button>
      </div>
    );
  }

  if (path === '/cart') {
    // Basic cancel/cart redirect
    window.history.pushState({}, '', '/');
  }

  return (
    <>
      <header className="header container">
        <h1 className="logo">DRIP STREET</h1>
        <button className="cart-btn" onClick={() => setIsCartOpen(true)}>
          CART ({cart.length})
        </button>
      </header>

      <section className="hero">
        <div className="container">
          <h1>ELEVATE YOUR STYLE</h1>
          <p>Premium streetwear crafted for the modern individual. Designed locally, made to last.</p>
        </div>
      </section>

      <main className="container">
        <div className="products-grid">
          {products.map(product => (
            <div key={product.id} className="product-card">
              <img src={product.imageUrl} alt={product.title} className="product-image" />
              <div className="product-info">
                <h3 className="product-title">{product.title}</h3>
                <span className="product-price">₪{product.price.toFixed(2)}</span>
              </div>
              <p className="product-desc">{product.description}</p>
              <button className="add-to-cart" onClick={() => addToCart(product)}>
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* Cart Drawer */}
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>Your Cart</h2>
          <button className="close-cart" onClick={() => setIsCartOpen(false)}>×</button>
        </div>
        <div className="cart-items">
          {cart.map(item => (
            <div key={item.id} className="cart-item">
              <div>
                <strong>{item.title}</strong>
                <div>Qty: {item.quantity}</div>
              </div>
              <div>₪{(item.price * item.quantity).toFixed(2)}</div>
            </div>
          ))}
          {cart.length === 0 && <p style={{color: '#666'}}>Your cart is empty.</p>}
        </div>
        <div className="cart-footer">
          <div className="cart-total">
            <span>Total</span>
            <span>₪{cartTotal.toFixed(2)} {paymentMethod === 'stripe' && `(~$${(cartTotal / 3.7).toFixed(2)})`}</span>
          </div>
          
          <div style={{ marginTop: '16px', marginBottom: '16px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#888' }}>Pay with:</p>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="payment" 
                  value="payplus" 
                  checked={paymentMethod === 'payplus'} 
                  onChange={() => setPaymentMethod('payplus')} 
                />
                Credit Card / Bit (₪)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="payment" 
                  value="stripe" 
                  checked={paymentMethod === 'stripe'} 
                  onChange={() => setPaymentMethod('stripe')} 
                />
                Stripe ($)
              </label>
            </div>
          </div>

          <button 
            className="checkout-btn" 
            onClick={checkout}
            disabled={cart.length === 0}
            style={{ opacity: cart.length === 0 ? 0.5 : 1 }}
          >
            Checkout with {paymentMethod === 'stripe' ? 'Stripe' : 'PayPlus'}
          </button>
        </div>
      </div>
    </>
  )
}

export default App
