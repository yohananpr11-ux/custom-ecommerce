import { useState, useEffect } from 'react'
import './index.css'

function App() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [isCartOpen, setIsCartOpen] = useState(false)

  useEffect(() => {
    // Fetch products from backend
    fetch('http://localhost:4000/api/products')
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
      const response = await fetch('http://localhost:4000/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
          address: '123 Street, Tel Aviv',
          items: cart,
          totalAmount: cartTotal
        })
      });
      const data = await response.json();
      if (data.success) {
        alert('Order placed successfully! ' + data.message);
        setCart([]);
        setIsCartOpen(false);
      }
    } catch (error) {
      console.error(error);
      alert('Checkout failed.');
    }
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
            <span>₪{cartTotal.toFixed(2)}</span>
          </div>
          <button 
            className="checkout-btn" 
            onClick={checkout}
            disabled={cart.length === 0}
            style={{ opacity: cart.length === 0 ? 0.5 : 1 }}
          >
            Checkout
          </button>
        </div>
      </div>
    </>
  )
}

export default App
